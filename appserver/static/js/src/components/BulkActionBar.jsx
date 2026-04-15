/**
 * components/BulkActionBar.jsx
 * Sticky action bar shown when rows are selected in the IOC table.
 * Provides: enable, disable, delete, extend expiry, set policy.
 */

import React, { useState } from 'react';
import Button      from '@splunk/react-ui/Button';
import Select      from '@splunk/react-ui/Select';
import Text        from '@splunk/react-ui/Text';
import Modal       from '@splunk/react-ui/Modal';
import Message     from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';

export default function BulkActionBar({ selected, policies, onAction, onClear }) {
  const count = selected.size;
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [showExtend,     setShowExtend]     = useState(false);
  const [showSetPolicy,  setShowSetPolicy]  = useState(false);
  const [deltaHours,     setDeltaHours]     = useState(24);
  const [policyNames,    setPolicyNames]    = useState([]);

  if (count === 0) return null;

  const run = async (action, extra = {}) => {
    setLoading(true);
    setError(null);
    const res = await onAction(action, extra);
    if (res?.error) setError(res.error);
    setLoading(false);
  };

  return (
    <>
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#1e3a5f', color: '#fff',
        padding: '8px 16px', borderRadius: 4,
        display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap', marginBottom: 8,
      }}>
        <span style={{ fontWeight: 600 }}>{count} selected</span>

        {loading && <WaitSpinner size="small" />}
        {error   && <span style={{ color: '#ff8080', fontSize: 12 }}>{error}</span>}

        <Button
          appearance="secondary" label="Enable"
          onClick={() => run('bulk_enable')}
          disabled={loading}
        />
        <Button
          appearance="secondary" label="Disable"
          onClick={() => run('bulk_disable')}
          disabled={loading}
        />
        <Button
          appearance="secondary" label="Extend Expiry…"
          onClick={() => setShowExtend(true)}
          disabled={loading}
        />
        <Button
          appearance="secondary" label="Set Policy…"
          onClick={() => setShowSetPolicy(true)}
          disabled={loading}
        />
        <Button
          appearance="destructive" label="Delete"
          onClick={() => run('bulk_delete')}
          disabled={loading}
        />
        <Button
          appearance="secondary" label="Clear selection"
          onClick={onClear}
          disabled={loading}
        />
      </div>

      {/* Extend expiry modal */}
      <Modal open={showExtend} onRequestClose={() => setShowExtend(false)}>
        <Modal.Header title="Extend Expiry" />
        <Modal.Body>
          <p>Extend the stop_time of {count} selected IOCs by how many hours?</p>
          <Text
            type="number" value={String(deltaHours)}
            onChange={(_, { value }) => setDeltaHours(Number(value))}
            style={{ width: 120 }}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button label="Cancel" onClick={() => setShowExtend(false)} />
          <Button
            appearance="primary" label="Extend"
            onClick={async () => {
              setShowExtend(false);
              await run('bulk_extend', { delta_hours: deltaHours });
            }}
          />
        </Modal.Footer>
      </Modal>

      {/* Set policy modal */}
      <Modal open={showSetPolicy} onRequestClose={() => setShowSetPolicy(false)}>
        <Modal.Header title="Set Policy" />
        <Modal.Body>
          <p>Assign a policy to {count} selected IOCs:</p>
          <Select
            multiple
            value={policyNames}
            onChange={(_, { values }) => setPolicyNames(values)}
            style={{ width: 300 }}
          >
            {policies.map(p => (
              <Select.Option key={p._key} value={p.name} label={p.name} />
            ))}
          </Select>
        </Modal.Body>
        <Modal.Footer>
          <Button label="Cancel" onClick={() => setShowSetPolicy(false)} />
          <Button
            appearance="primary" label="Apply"
            onClick={async () => {
              setShowSetPolicy(false);
              await run('bulk_set_policy', { policy_names: policyNames });
            }}
            loading={loading}
          />
        </Modal.Footer>
      </Modal>
    </>
  );
}
