/**
 * components/ConflictManager.jsx
 * Lists open block/allow conflicts, lets analyst resolve with
 * block_wins / allow_wins / remove_both strategy.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Table       from '@splunk/react-ui/Table';
import Button      from '@splunk/react-ui/Button';
import Select      from '@splunk/react-ui/Select';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Badge       from '@splunk/react-ui/Badge';
import Modal       from '@splunk/react-ui/Modal';
import api         from '../api/api';

const RESOLUTION_OPTS = [
  { value: 'block_wins',  label: 'Block wins (deactivate allow)' },
  { value: 'allow_wins',  label: 'Allow wins (deactivate block)' },
  { value: 'remove_both', label: 'Remove both' },
];

export default function ConflictManager({ onResolved }) {
  const [conflicts,   setConflicts]   = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolution,  setResolution]  = useState('block_wins');
  const [resolving,   setResolving]   = useState(false);
  const [filter,      setFilter]      = useState('open');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = {};
    if (filter) params.state = filter;
    const res = await api.conflicts.list(params);
    if (res.error) setError(res.error);
    else setConflicts(res.data?.items || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const openResolve = c => { setResolveTarget(c); setResolution('block_wins'); };
  const closeResolve = () => setResolveTarget(null);

  const doResolve = useCallback(async () => {
    if (!resolveTarget) return;
    setResolving(true);
    const res = await api.conflicts.resolve(resolveTarget._key, { resolution });
    setResolving(false);
    if (res.error) { setError(res.error); return; }
    closeResolve();
    load();
    onResolved();
  }, [resolveTarget, resolution, load, onResolved]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Conflicts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select value={filter} onChange={(_, { value }) => setFilter(value)} style={{ width: 140 }}>
            <Select.Option value="open"     label="Open" />
            <Select.Option value="resolved" label="Resolved" />
            <Select.Option value=""         label="All" />
          </Select>
          <Button label="Refresh" onClick={load} />
        </div>
      </div>

      {error   && <Message appearance="error"   style={{ marginBottom: 8 }}>{error}</Message>}
      {loading && <WaitSpinner />}

      {!loading && (
        <Table stripeRows>
          <Table.Head>
            <Table.HeadCell>Type</Table.HeadCell>
            <Table.HeadCell>Value</Table.HeadCell>
            <Table.HeadCell>State</Table.HeadCell>
            <Table.HeadCell>Detected</Table.HeadCell>
            <Table.HeadCell>Resolution</Table.HeadCell>
            <Table.HeadCell>Actions</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {conflicts.map(c => (
              <Table.Row key={c._key}>
                <Table.Cell><Badge>{c.type}</Badge></Table.Cell>
                <Table.Cell style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.value}</Table.Cell>
                <Table.Cell>
                  <Badge appearance={c.state === 'open' ? 'destructive' : 'success'}>{c.state}</Badge>
                </Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{c.detected_at?.substring(0, 19)}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{c.resolution || '—'}</Table.Cell>
                <Table.Cell>
                  {c.state === 'open' && (
                    <Button appearance="primary" label="Resolve" onClick={() => openResolve(c)} />
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
            {conflicts.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={6} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  No conflicts found. 🎉
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}

      {/* Resolve modal */}
      {resolveTarget && (
        <Modal open onRequestClose={closeResolve} style={{ width: 440 }}>
          <Modal.Header title="Resolve Conflict" onRequestClose={closeResolve} />
          <Modal.Body>
            <p>
              Value: <strong style={{ fontFamily: 'monospace' }}>{resolveTarget.value}</strong>
              {' '}exists in both block and allow lists.
            </p>
            <label>Resolution strategy<br />
              <Select value={resolution} onChange={(_, { value }) => setResolution(value)} style={{ width: '100%', marginTop: 4 }}>
                {RESOLUTION_OPTS.map(o => <Select.Option key={o.value} value={o.value} label={o.label} />)}
              </Select>
            </label>
          </Modal.Body>
          <Modal.Footer>
            {resolving
              ? <WaitSpinner />
              : <Button appearance="primary" label="Apply" onClick={doResolve} />
            }
            <Button label="Cancel" onClick={closeResolve} />
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
