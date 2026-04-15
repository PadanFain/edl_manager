/**
 * components/AuditLog.jsx
 * Read-only paginated audit log viewer with actor/action/date filters.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Table       from '@splunk/react-ui/Table';
import Select      from '@splunk/react-ui/Select';
import Text        from '@splunk/react-ui/Text';
import Button      from '@splunk/react-ui/Button';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Paginator   from '@splunk/react-ui/Paginator';
import api from '../api/api';

const PAGE_SIZE = 100;

const ACTION_OPTIONS = [
  { value: '',       label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'import', label: 'Import' },
  { value: 'export', label: 'Export' },
  { value: 'poll',   label: 'Poll (TAXII)' },
];

export default function AuditLog() {
  const [entries,  setEntries]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [actor,    setActor]    = useState('');
  const [action,   setAction]   = useState('');
  const [start,    setStart]    = useState('');
  const [end,      setEnd]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = { page, page_size: PAGE_SIZE };
    if (actor)  params.actor  = actor;
    if (action) params.action = action;
    if (start)  params.start  = start;
    if (end)    params.end    = end;
    const res = await api.audit.list(params);
    if (res.error) setError(res.error);
    else {
      setEntries(res.data?.items || []);
      setTotal(res.data?.total_count || 0);
    }
    setLoading(false);
  }, [page, actor, action, start, end]);

  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setActor(''); setAction(''); setStart(''); setEnd(''); setPage(1);
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 16 }}>Audit Log</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Text placeholder="Actor" value={actor} onChange={(_, { value }) => { setActor(value); setPage(1); }} style={{ width: 160 }} />
        <Select value={action} onChange={(_, { value }) => { setAction(value); setPage(1); }} style={{ width: 160 }}>
          {ACTION_OPTIONS.map(o => <Select.Option key={o.value} value={o.value} label={o.label} />)}
        </Select>
        <Text placeholder="Start (ISO 8601)" value={start} onChange={(_, { value }) => { setStart(value); setPage(1); }} style={{ width: 180 }} />
        <Text placeholder="End (ISO 8601)" value={end} onChange={(_, { value }) => { setEnd(value); setPage(1); }} style={{ width: 180 }} />
        <Button onClick={reset} label="Reset" />
      </div>

      {error && <Message appearance="error" style={{ marginBottom: 12 }}>{error}</Message>}
      {loading && <WaitSpinner />}

      {!loading && (
        <Table stripeRows>
          <Table.Head>
            <Table.HeadCell>Timestamp</Table.HeadCell>
            <Table.HeadCell>Actor</Table.HeadCell>
            <Table.HeadCell>Action</Table.HeadCell>
            <Table.HeadCell>Type</Table.HeadCell>
            <Table.HeadCell>Target</Table.HeadCell>
            <Table.HeadCell>Changes</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {entries.map(e => (
              <Table.Row key={e._key}>
                <Table.Cell>{e.timestamp_iso}</Table.Cell>
                <Table.Cell>{e.actor}</Table.Cell>
                <Table.Cell>{e.action}</Table.Cell>
                <Table.Cell>{e.target_type}</Table.Cell>
                <Table.Cell style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.target_value || e.target_key}
                </Table.Cell>
                <Table.Cell style={{ fontSize: 11, color: '#666', maxWidth: 300 }}>
                  {e.changes && e.changes !== '{}' ? e.changes : '—'}
                </Table.Cell>
              </Table.Row>
            ))}
            {entries.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={6} style={{ textAlign: 'center', color: '#999' }}>No audit entries found.</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}

      {total > PAGE_SIZE && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <Paginator
            current={page} total={Math.ceil(total / PAGE_SIZE)}
            onChange={(_, { page: p }) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
}
