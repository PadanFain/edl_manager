#!/usr/bin/env python3
"""
edl_feed.py
────────────────────────────────────────────────────────────────────────────
Custom generating search command: | edl_feed

Splunk Cloud compatible — uses the 'generating' command type which runs
server-side but does NOT require restmap.conf or BaseRestHandler.
Generating commands are permitted on Splunk Cloud.

Usage from SPL:
    | edl_feed
    | edl_feed type=ip list_type=block
    | edl_feed policy=threat-intel type=ip list_type=block format=text
    | edl_feed status=active list_type=block exclude_conflicts=true
    | edl_feed precedence=allow_wins

Arguments:
    type              ip | url | domain | all (default: all)
    list_type         block | allow | all  (default: all)
    policy            policy name substring filter (default: all)
    status            active | inactive | all (default: active)
    format            splunk | text (default: splunk)
    exclude_conflicts true | false (default: false)
    precedence        block_wins | allow_wins (default: block_wins)
    min_hits          integer (default: 0)

CRITICAL commands.conf requirements (verified from SDK source):
    chunked         = true   (SCP v2 — required for self.service)
    requires_srinfo = true   (passes search results info file — required for self.service)
Without both, self.service returns None and KV Store reads silently fail.
"""

import sys
import os
import json
import time
import re
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.environ.get('SPLUNK_HOME', '/opt/splunk'),
                                'lib', 'python3.9', 'site-packages'))
sys.path.insert(0, os.path.join(os.environ.get('SPLUNK_HOME', '/opt/splunk'),
                                'etc', 'apps', 'edl_manager', 'bin'))

import splunklib.searchcommands as sc
from splunklib.searchcommands import dispatch, GeneratingCommand, Configuration, Option, validators


class OneOf(validators.Validator):
    """Validates that a value is one of a fixed set (case-insensitive)."""
    def __init__(self, *choices):
        self.choices = [c.lower() for c in choices]
        self.choices_display = ' | '.join(choices)

    def __call__(self, value):
        if value is None:
            return None
        v = value.strip().lower()
        if v not in self.choices:
            raise ValueError(f"Expected one of: {self.choices_display}; got '{value}'")
        return v

    def format(self, value):
        return str(value) if value is not None else ''


def _now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _in_24h_iso():
    return (datetime.now(timezone.utc) + timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')


def _compute_status(start_time, stop_time, stored_status):
    now = _now_iso()
    if stop_time  and stop_time  < now: return 'inactive'
    if start_time and start_time > now: return 'inactive'
    return stored_status or 'active'


def _apply_precedence(docs, precedence):
    winner = 'block' if precedence == 'block_wins' else 'allow'
    groups = {}
    for doc in docs:
        key = (doc.get('type', ''), doc.get('value', ''))
        groups.setdefault(key, []).append(doc)
    result = []
    for entries in groups.values():
        list_types = {e.get('list_type') for e in entries}
        if 'block' in list_types and 'allow' in list_types:
            result.extend(e for e in entries if e.get('list_type') == winner)
        else:
            result.extend(entries)
    return result


def _kv_fetch_all(service, collection, query=None):
    """Fetch all documents from a KV Store collection, paginating at 10k."""
    endpoint = f'/servicesNS/nobody/edl_manager/storage/collections/data/{collection}'
    params   = {'output_mode': 'json', 'count': '10000'}
    if query:
        params['query'] = json.dumps(query)
    all_docs = []
    offset   = 0
    while True:
        params['offset'] = str(offset)
        response = service.get(endpoint, **params)
        body     = response.body.read()
        if isinstance(body, bytes):
            body = body.decode('utf-8')
        docs = json.loads(body)
        if not docs:
            break
        all_docs.extend(docs)
        if len(docs) < 10000:
            break
        offset += 10000
    return all_docs


@Configuration(type='events', retainsevents=False, streaming=False)
class EDLFeedCommand(GeneratingCommand):
    """| edl_feed — generates IOC feed results from the EDL Manager KV Store."""

    type = Option(name='type', require=False, default='all',
                  validate=OneOf('ip', 'url', 'domain', 'all'))
    list_type = Option(name='list_type', require=False, default='all',
                       validate=OneOf('block', 'allow', 'all'))
    policy = Option(name='policy', require=False, default=None)
    status = Option(name='status', require=False, default='active',
                    validate=OneOf('active', 'inactive', 'all'))
    format = Option(name='format', require=False, default='splunk',
                    validate=OneOf('splunk', 'text'))
    exclude_conflicts = Option(name='exclude_conflicts', require=False,
                               default=False, validate=validators.Boolean())
    precedence = Option(name='precedence', require=False, default='block_wins',
                        validate=OneOf('block_wins', 'allow_wins'))
    min_hits = Option(name='min_hits', require=False, default=0,
                      validate=validators.Integer(minimum=0))

    def generate(self):
        """
        Main entry point. Fetches IOCs from KV Store, filters, yields rows.

        Requires commands.conf:
            requires_srinfo = true   (self.service needs the search results info file)
            chunked         = true   (SCP v2 — needed for auth token injection)
        Without both, self.service is None and all KV Store reads fail silently.
        """
        service = self.service

        if service is None:
            self.error_exit(
                RuntimeError("service is None"),
                "| edl_feed could not obtain a Splunk service object. "
                "Ensure commands.conf has: requires_srinfo=true AND chunked=true.",
            )
            return

        kv_query = {}
        if self.type     and self.type     != 'all': kv_query['type']      = self.type
        if self.list_type and self.list_type != 'all': kv_query['list_type'] = self.list_type

        try:
            raw_docs = _kv_fetch_all(service, 'ioc_entries',
                                     query=kv_query if kv_query else None)
        except Exception as exc:
            self.error_exit(exc, f'Failed to read ioc_entries KV Store: {exc}')
            return

        now_iso   = _now_iso()
        in24h_iso = _in_24h_iso()
        filtered  = []

        for doc in raw_docs:
            live_status = _compute_status(doc.get('start_time'), doc.get('stop_time'),
                                          doc.get('status', 'active'))
            if self.status != 'all' and live_status != self.status:
                continue
            if self.exclude_conflicts and doc.get('conflict_state') == 'conflict':
                continue
            if self.policy:
                pol_lower = self.policy.lower()
                pol_names = doc.get('policy_names', [])
                if isinstance(pol_names, str): pol_names = [pol_names]
                if not any(pol_lower in (p or '').lower() for p in pol_names):
                    continue
            if self.min_hits and int(doc.get('hit_count', 0) or 0) < self.min_hits:
                continue
            doc['live_status']    = live_status
            doc['expiry_warning'] = bool(doc.get('stop_time')
                                         and now_iso < doc['stop_time'] <= in24h_iso)
            filtered.append(doc)

        if self.list_type == 'all':
            filtered = _apply_precedence(filtered, self.precedence)

        if self.format == 'text':
            values    = [doc.get('value', '') for doc in filtered if doc.get('value')]
            feed_text = '\n'.join(values)
            yield {
                '_time': time.time(), '_raw': feed_text, 'feed': feed_text,
                'count': str(len(values)), 'generated_at': now_iso,
                'filters': json.dumps({
                    'type': self.type, 'list_type': self.list_type,
                    'policy': self.policy or 'all', 'status': self.status,
                    'exclude_conflicts': str(self.exclude_conflicts),
                    'precedence': self.precedence, 'min_hits': str(self.min_hits),
                }),
            }
        else:
            for doc in filtered:
                pol_names = doc.get('policy_names', [])
                if isinstance(pol_names, list): pol_names = ','.join(pol_names)
                tags = doc.get('tags', [])
                if isinstance(tags, list): tags = ','.join(tags)
                yield {
                    '_time': time.time(), '_raw': doc.get('value', ''),
                    '_key':             doc.get('_key', ''),
                    'value':            doc.get('value', ''),
                    'type':             doc.get('type', ''),
                    'list_type':        doc.get('list_type', ''),
                    'policy_names':     pol_names,
                    'status':           doc.get('live_status', ''),
                    'start_time':       doc.get('start_time', ''),
                    'stop_time':        doc.get('stop_time', ''),
                    'description':      doc.get('description', ''),
                    'source':           doc.get('source', ''),
                    'source_ref':       doc.get('source_ref', ''),
                    'tags':             tags,
                    'conflict_state':   doc.get('conflict_state', 'none'),
                    'hit_count':        str(doc.get('hit_count', 0)),
                    'last_hit_at':      doc.get('last_hit_at', ''),
                    'expiry_warning':   '1' if doc.get('expiry_warning') else '0',
                    'created_by':       doc.get('created_by', ''),
                    'created_at':       doc.get('created_at', ''),
                    'last_modified_at': doc.get('last_modified_at', ''),
                }


if __name__ == '__main__':
    dispatch(EDLFeedCommand, sys.argv, sys.stdin, sys.stdout, __name__)
