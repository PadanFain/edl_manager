/**
 * components/TokenManager.jsx
 * Manage EDLTokens used by firewalls to authenticate feed requests.
 * Raw token shown once on creation — never stored or re-displayed.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Table       from '@splunk/react-ui/Table';
import Button      from '@splunk/react-ui/Button';
import Text        from '@splunk/react-ui/Text';
import TextArea    from '@splunk/react-ui/TextArea';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Badge       from '@splunk/react-ui/Badge';
import Modal       from '@splunk/react-ui/Modal';
import api         from '../api/api';

export default function TokenManager() {
  const [tokens,     setTokens]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form,       setForm]       = useState({ name: '', description: '', expires_at: '' });
  const [saving,     setSaving]     = useState(false);
  const [newToken,   setNewToken]   = useState(null);   // shown once after creation
  const [revoking,   setRevoking]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.tokens.list();
    if (res.error) setError(res.error);
    else setTokens(res.data?.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!form.name.trim()) { setError('Name required'); return; }
    setSaving(true); setError(null);
    const res = await api.tokens.create({
      name:        form.name.trim(),
      description: form.description.trim(),
      expires_at:  form.expires_at.trim(),
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setShowCreate(false);
    setNewToken(res.data);   // contains .token (raw) — show immediately
    setForm({ name: '', description: '', expires_at: '' });
    load();
  }, [form, load]);

  const revoke = useCallback(async key => {
    setRevoking(key);
    await api.tokens.revoke(key);
    setRevoking(null);
    load();
  }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>EDL Tokens</h2>
        <Button appearance="primary" label="+ Create Token" onClick={() => setShowCreate(true)} />
      </div>

      <Message appearance="info" style={{ marginBottom: 12 }}>
        Tokens authorize firewall access to feed endpoints.
        Use <code>Authorization: EDLToken &lt;token&gt;</code> in firewall EDL config.
      </Message>

      {error   && <Message appearance="error" style={{ marginBottom: 8 }}>{error}</Message>}
      {loading && <WaitSpinner />}

      {!loading && (
        <Table stripeRows>
          <Table.Head>
            <Table.HeadCell>Name</Table.HeadCell>
            <Table.HeadCell>Description</Table.HeadCell>
            <Table.HeadCell>Status</Table.HeadCell>
            <Table.HeadCell>Created</Table.HeadCell>
            <Table.HeadCell>Expires</Table.HeadCell>
            <Table.HeadCell>Last used</Table.HeadCell>
            <Table.HeadCell>Actions</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {tokens.map(t => (
              <Table.Row key={t._key}>
                <Table.Cell><strong>{t.name}</strong></Table.Cell>
                <Table.Cell style={{ color: '#666', fontSize: 12 }}>{t.description || '—'}</Table.Cell>
                <Table.Cell>
                  <Badge appearance={t.status === 'active' ? 'success' : 'destructive'}>{t.status}</Badge>
                </Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{t.created_at?.substring(0, 10)}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{t.expires_at || '∞'}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{t.last_used_at?.substring(0, 10) || 'never'}</Table.Cell>
                <Table.Cell>
                  {t.status === 'active' && (
                    <Button
                      appearance="destructive"
                      label={revoking === t._key ? '…' : 'Revoke'}
                      onClick={() => revoke(t._key)}
                      disabled={revoking === t._key}
                    />
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
            {tokens.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={7} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  No tokens yet. Create one to give firewalls feed access.
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal open onRequestClose={() => setShowCreate(false)} style={{ width: 440 }}>
          <Modal.Header title="Create Token" onRequestClose={() => setShowCreate(false)} />
          <Modal.Body>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>Name *<br />
                <Text value={form.name} onChange={(_, { value }) => setForm(f => ({ ...f, name: value }))} style={{ width: '100%' }} />
              </label>
              <label>Description<br />
                <Text value={form.description} onChange={(_, { value }) => setForm(f => ({ ...f, description: value }))} style={{ width: '100%' }} />
              </label>
              <label>Expires at (ISO 8601, leave blank for no expiry)<br />
                <Text placeholder="2026-12-31T00:00:00Z" value={form.expires_at}
                  onChange={(_, { value }) => setForm(f => ({ ...f, expires_at: value }))} style={{ width: '100%' }} />
              </label>
            </div>
          </Modal.Body>
          <Modal.Footer>
            {saving ? <WaitSpinner /> : <Button appearance="primary" label="Create" onClick={create} />}
            <Button label="Cancel" onClick={() => setShowCreate(false)} />
          </Modal.Footer>
        </Modal>
      )}

      {/* One-time token display */}
      {newToken && (
        <Modal open onRequestClose={() => setNewToken(null)} style={{ width: 520 }}>
          <Modal.Header title="Token Created — Save Now" onRequestClose={() => setNewToken(null)} />
          <Modal.Body>
            <Message appearance="warning" style={{ marginBottom: 12 }}>
              This is the only time the token will be shown. Copy it now.
            </Message>
            <TextArea
              value={newToken.token}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
              rowsMin={3}
              readOnly
            />
            <p style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
              Use in firewall: <code>Authorization: EDLToken {newToken.token}</code>
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button appearance="primary" label="Done — I've copied it" onClick={() => setNewToken(null)} />
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
