/**
 * components/FeedManager.jsx
 * Shows all feed endpoint URLs (6 combinations: ip/url/domain × block/allow)
 * with copy buttons and a live connectivity test via HEAD request.
 */
import React, { useState, useCallback } from 'react';
import Table   from '@splunk/react-ui/Table';
import Button  from '@splunk/react-ui/Button';
import Badge   from '@splunk/react-ui/Badge';
import Message from '@splunk/react-ui/Message';
import Text    from '@splunk/react-ui/Text';
import api     from '../api/api';

const FEED_COMBOS = [
  { type: 'ip',     list_type: 'block' },
  { type: 'ip',     list_type: 'allow' },
  { type: 'url',    list_type: 'block' },
  { type: 'url',    list_type: 'allow' },
  { type: 'domain', list_type: 'block' },
  { type: 'domain', list_type: 'allow' },
];

export default function FeedManager() {
  const [copied,  setCopied]  = useState(null);
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});
  const [testToken, setTestToken] = useState('');

  const copy = useCallback((url, key) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(c => c === key ? null : c), 2000);
  }, []);

  const test = useCallback(async (url, key) => {
    setTesting(key);
    try {
      const headers = { 'Authorization': `EDLToken ${testToken}` };
      const res = await fetch(url, { method: 'HEAD', headers, credentials: 'omit' });
      setResults(r => ({ ...r, [key]: { ok: res.ok, status: res.status } }));
    } catch (err) {
      setResults(r => ({ ...r, [key]: { ok: false, status: err.message } }));
    }
    setTesting(null);
  }, [testToken]);

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 8 }}>Feed Endpoints</h2>

      <Message appearance="info" style={{ marginBottom: 16 }}>
        Firewalls poll these URLs every refresh interval. Include an <code>EDLToken</code> in the
        Authorization header. Append <code>&amp;format=json</code> for JSON output.
      </Message>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <Text
          placeholder="EDLToken for live test (optional)"
          value={testToken}
          onChange={(_, { value }) => setTestToken(value)}
          type="password"
          style={{ width: 320 }}
        />
      </div>

      <Table stripeRows>
        <Table.Head>
          <Table.HeadCell>Type</Table.HeadCell>
          <Table.HeadCell>List</Table.HeadCell>
          <Table.HeadCell>URL</Table.HeadCell>
          <Table.HeadCell style={{ width: 200 }}>Actions</Table.HeadCell>
        </Table.Head>
        <Table.Body>
          {FEED_COMBOS.map(({ type, list_type }) => {
            const key = `${type}_${list_type}`;
            const url = api.feed.url(type, list_type);
            const res = results[key];
            return (
              <Table.Row key={key}>
                <Table.Cell><Badge>{type}</Badge></Table.Cell>
                <Table.Cell>
                  <Badge appearance={list_type === 'block' ? 'destructive' : 'info'}>{list_type}</Badge>
                </Table.Cell>
                <Table.Cell>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{url}</span>
                  {res && (
                    <Badge
                      appearance={res.ok ? 'success' : 'destructive'}
                      style={{ marginLeft: 8 }}
                    >
                      {res.status}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Button
                    label={copied === key ? '✓ Copied' : 'Copy'}
                    onClick={() => copy(url, key)}
                    style={{ marginRight: 4 }}
                  />
                  <Button
                    label={testing === key ? 'Testing…' : 'Test'}
                    onClick={() => test(url, key)}
                    disabled={testing === key || !testToken}
                  />
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>

      <div style={{ marginTop: 24, background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 14 }}>Palo Alto Networks config snippet</h3>
        <pre style={{ margin: 0, fontSize: 12, overflowX: 'auto' }}>{`set external-list BLOCK_IPS type ip
set external-list BLOCK_IPS source ${api.feed.url('ip', 'block')}
set external-list BLOCK_IPS auth type header
set external-list BLOCK_IPS auth header "Authorization: EDLToken <your_token>"`}</pre>
      </div>
    </div>
  );
}
