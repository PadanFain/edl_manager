/**
 * components/TAXIIManager.jsx
 * CRUD for TAXII 2.1 sources + manual poll trigger + run history.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Table       from '@splunk/react-ui/Table';
import Button      from '@splunk/react-ui/Button';
import Text        from '@splunk/react-ui/Text';
import Select      from '@splunk/react-ui/Select';
import Checkbox    from '@splunk/react-ui/Checkbox';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Badge       from '@splunk/react-ui/Badge';
import Modal       from '@splunk/react-ui/Modal';
import api         from '../api/api';

const EMPTY_FORM = {
  name: '', url: '', collection_id: '', username: '', password: '', api_key: '',
  auth_type: 'none', poll_interval: '3600', list_type: 'block', enabled: true,
};

const AUTH_OPTS = [
  { value: 'none',    label: 'None' },
  { value: 'basic',   label: 'Basic (username/password)' },
  { value: 'api_key', label: 'API Key (Bearer)' },
];

export default function TAXIIManager({ policies }) {
  const [sources,  setSources]  = useState([]);
  const [runs,     setRuns]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [polling,  setPolling]  = useState(null);
  const [activeTab,setActiveTab]= useState('sources');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [sRes, rRes] = await Promise.all([api.taxii.list(), api.audit.list({ action: 'poll', page_size: 20 })]);
    if (sRes.error) setError(sRes.error);
    else setSources(sRes.data?.items || []);
    if (!rRes.error) setRuns(rRes.data?.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditItem(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit   = s  => {
    setEditItem(s);
    setForm({
      name: s.name, url: s.url, collection_id: s.collection_id,
      username: s.username || '', password: '', api_key: '',
      auth_type: s.auth_type || 'none',
      poll_interval: String(s.poll_interval || 3600),
      list_type: s.list_type || 'block',
      enabled: s.enabled !== false,
    });
    setShowForm(true);
  };
  const closeForm = () => setShowForm(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = useCallback(async () => {
    if (!form.name || !form.url || !form.collection_id) {
      setError('Name, URL and Collection ID are required.'); return;
    }
    setSaving(true); setError(null);
    const payload = { ...form, poll_interval: Number(form.poll_interval) };
    const res = editItem
      ? await api.taxii.update(editItem._key, payload)
      : await api.taxii.create(payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    closeForm(); load();
  }, [form, editItem, load]);

  const del = useCallback(async key => {
    await api.taxii.delete(key); load();
  }, [load]);

  const poll = useCallback(async key => {
    setPolling(key);
    await api.taxii.poll(key);
    setPolling(null); load();
  }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>TAXII Sources</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button label={activeTab === 'sources' ? '● Sources' : 'Sources'} onClick={() => setActiveTab('sources')} />
          <Button label={activeTab === 'runs' ? '● Run History' : 'Run History'} onClick={() => setActiveTab('runs')} />
          {activeTab === 'sources' && <Button appearance="primary" label="+ Add Source" onClick={openCreate} />}
        </div>
      </div>

      {error   && <Message appearance="error" style={{ marginBottom: 8 }}>{error}</Message>}
      {loading && <WaitSpinner />}

      {!loading && activeTab === 'sources' && (
        <Table stripeRows>
          <Table.Head>
            <Table.HeadCell>Name</Table.HeadCell>
            <Table.HeadCell>URL</Table.HeadCell>
            <Table.HeadCell>Collection</Table.HeadCell>
            <Table.HeadCell>Auth</Table.HeadCell>
            <Table.HeadCell>List</Table.HeadCell>
            <Table.HeadCell>Interval</Table.HeadCell>
            <Table.HeadCell>Last poll</Table.HeadCell>
            <Table.HeadCell>Actions</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {sources.map(s => (
              <Table.Row key={s._key}>
                <Table.Cell>
                  <strong>{s.name}</strong>
                  {!s.enabled && <Badge style={{ marginLeft: 6 }}>disabled</Badge>}
                </Table.Cell>
                <Table.Cell style={{ fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.url}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{s.collection_id}</Table.Cell>
                <Table.Cell><Badge>{s.auth_type || 'none'}</Badge></Table.Cell>
                <Table.Cell><Badge appearance={s.list_type === 'block' ? 'destructive' : 'info'}>{s.list_type}</Badge></Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{Math.round((s.poll_interval || 3600) / 60)}m</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{s.last_polled_at?.substring(0, 16) || 'never'}</Table.Cell>
                <Table.Cell>
                  <Button label="Edit" onClick={() => openEdit(s)} style={{ marginRight: 4 }} />
                  <Button
                    label={polling === s._key ? 'Polling…' : 'Poll now'}
                    onClick={() => poll(s._key)}
                    disabled={polling === s._key}
                    style={{ marginRight: 4 }}
                  />
                  <Button appearance="destructive" label="Del" onClick={() => del(s._key)} />
                </Table.Cell>
              </Table.Row>
            ))}
            {sources.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={8} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  No TAXII sources configured.
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}

      {!loading && activeTab === 'runs' && (
        <Table stripeRows>
          <Table.Head>
            <Table.HeadCell>Source</Table.HeadCell>
            <Table.HeadCell>Started</Table.HeadCell>
            <Table.HeadCell>Status</Table.HeadCell>
            <Table.HeadCell>Imported</Table.HeadCell>
            <Table.HeadCell>Error</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {runs.map((r, i) => (
              <Table.Row key={i}>
                <Table.Cell>{r.target_value || r.target_key}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{r.timestamp_iso?.substring(0, 16)}</Table.Cell>
                <Table.Cell>
                  <Badge appearance={r.action === 'poll' ? 'success' : 'info'}>{r.action}</Badge>
                </Table.Cell>
                <Table.Cell>—</Table.Cell>
                <Table.Cell style={{ fontSize: 12, color: '#d41f1f' }}>{r.error || ''}</Table.Cell>
              </Table.Row>
            ))}
            {runs.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={5} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  No poll runs recorded yet.
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <Modal open onRequestClose={closeForm} style={{ width: 520 }}>
          <Modal.Header title={editItem ? 'Edit TAXII Source' : 'Add TAXII Source'} onRequestClose={closeForm} />
          <Modal.Body>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label>Name *<br /><Text value={form.name} onChange={(_, { value }) => set('name', value)} style={{ width: '100%' }} /></label>
              <label>TAXII 2.1 server URL *<br /><Text placeholder="https://taxii.example.com/taxii/" value={form.url} onChange={(_, { value }) => set('url', value)} style={{ width: '100%' }} /></label>
              <label>Collection ID *<br /><Text value={form.collection_id} onChange={(_, { value }) => set('collection_id', value)} style={{ width: '100%' }} /></label>
              <label>Auth type<br />
                <Select value={form.auth_type} onChange={(_, { value }) => set('auth_type', value)} style={{ width: '100%' }}>
                  {AUTH_OPTS.map(o => <Select.Option key={o.value} value={o.value} label={o.label} />)}
                </Select>
              </label>
              {form.auth_type === 'basic' && <>
                <label>Username<br /><Text value={form.username} onChange={(_, { value }) => set('username', value)} style={{ width: '100%' }} /></label>
                <label>Password<br /><Text type="password" value={form.password} onChange={(_, { value }) => set('password', value)} style={{ width: '100%' }} /></label>
              </>}
              {form.auth_type === 'api_key' && (
                <label>API Key<br /><Text type="password" value={form.api_key} onChange={(_, { value }) => set('api_key', value)} style={{ width: '100%' }} /></label>
              )}
              <div style={{ display: 'flex', gap: 12 }}>
                <label>List type<br />
                  <Select value={form.list_type} onChange={(_, { value }) => set('list_type', value)} style={{ width: 120 }}>
                    <Select.Option value="block" label="Block" />
                    <Select.Option value="allow" label="Allow" />
                  </Select>
                </label>
                <label>Poll interval (seconds)<br />
                  <Text type="number" value={form.poll_interval} onChange={(_, { value }) => set('poll_interval', value)} style={{ width: 120 }} />
                </label>
              </div>
              <Checkbox label="Enabled" checked={form.enabled} onChange={(_, { checked }) => set('enabled', checked)} />
            </div>
          </Modal.Body>
          <Modal.Footer>
            {saving ? <WaitSpinner /> : <Button appearance="primary" label="Save" onClick={save} />}
            <Button label="Cancel" onClick={closeForm} />
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
