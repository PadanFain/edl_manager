/**
 * components/PolicyManager.jsx
 * Full CRUD for EDL policies. Notifies parent via onChanged so App can
 * reload the shared policies list (passed down to IOCTable, BulkImport, etc.)
 */
import React, { useState, useCallback } from 'react';
import Table       from '@splunk/react-ui/Table';
import Button      from '@splunk/react-ui/Button';
import Text        from '@splunk/react-ui/Text';
import TextArea    from '@splunk/react-ui/TextArea';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Modal       from '@splunk/react-ui/Modal';
import Checkbox    from '@splunk/react-ui/Checkbox';
import api         from '../api/api';

const EMPTY = { name: '', description: '', default_ttl_hours: '', auto_expire: false, tags: '' };

export default function PolicyManager({ policies, onChanged }) {
  const [showForm,  setShowForm]  = useState(false);
  const [editItem,  setEditItem]  = useState(null);
  const [form,      setForm]      = useState(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [delTarget, setDelTarget] = useState(null);

  const openCreate = () => { setEditItem(null); setForm(EMPTY); setError(null); setShowForm(true); };
  const openEdit   = p  => {
    setEditItem(p);
    setForm({
      name:             p.name || '',
      description:      p.description || '',
      default_ttl_hours:p.default_ttl_hours ?? '',
      auto_expire:      !!p.auto_expire,
      tags:             (p.tags || []).join(', '),
    });
    setError(null);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setError(null); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = useCallback(async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    const payload = {
      name:             form.name.trim(),
      description:      form.description.trim(),
      default_ttl_hours:form.default_ttl_hours !== '' ? Number(form.default_ttl_hours) : 0,
      auto_expire:      form.auto_expire,
      tags:             form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
    const res = editItem
      ? await api.policies.update(editItem._key, payload)
      : await api.policies.create(payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    closeForm();
    onChanged();
  }, [form, editItem, onChanged]);

  const confirmDelete = useCallback(async () => {
    if (!delTarget) return;
    const res = await api.policies.delete(delTarget._key);
    if (res.error) { setError(res.error); }
    setDelTarget(null);
    onChanged();
  }, [delTarget, onChanged]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Policies</h2>
        <Button appearance="primary" label="+ New Policy" onClick={openCreate} />
      </div>

      <Table stripeRows>
        <Table.Head>
          <Table.HeadCell>Name</Table.HeadCell>
          <Table.HeadCell>Description</Table.HeadCell>
          <Table.HeadCell>Default TTL (h)</Table.HeadCell>
          <Table.HeadCell>Auto-expire</Table.HeadCell>
          <Table.HeadCell>Tags</Table.HeadCell>
          <Table.HeadCell>Actions</Table.HeadCell>
        </Table.Head>
        <Table.Body>
          {policies.map(p => (
            <Table.Row key={p._key}>
              <Table.Cell><strong>{p.name}</strong></Table.Cell>
              <Table.Cell style={{ color: '#666' }}>{p.description || '—'}</Table.Cell>
              <Table.Cell>{p.default_ttl_hours || '∞'}</Table.Cell>
              <Table.Cell>{p.auto_expire ? '✔' : '—'}</Table.Cell>
              <Table.Cell style={{ fontSize: 12 }}>{(p.tags || []).join(', ') || '—'}</Table.Cell>
              <Table.Cell>
                <Button label="Edit" onClick={() => openEdit(p)} style={{ marginRight: 4 }} />
                <Button appearance="destructive" label="Delete" onClick={() => setDelTarget(p)} />
              </Table.Cell>
            </Table.Row>
          ))}
          {policies.length === 0 && (
            <Table.Row>
              <Table.Cell colSpan={6} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                No policies defined yet.
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table>

      {/* Create/Edit modal */}
      {showForm && (
        <Modal open onRequestClose={closeForm} style={{ width: 480 }}>
          <Modal.Header title={editItem ? `Edit: ${editItem.name}` : 'New Policy'} onRequestClose={closeForm} />
          <Modal.Body>
            {error && <Message appearance="error" style={{ marginBottom: 8 }}>{error}</Message>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>Name *<br />
                <Text value={form.name} onChange={(_, { value }) => set('name', value)}
                  disabled={!!editItem} style={{ width: '100%' }} />
              </label>
              <label>Description<br />
                <TextArea value={form.description} onChange={(_, { value }) => set('description', value)}
                  style={{ width: '100%' }} rowsMin={2} />
              </label>
              <label>Default TTL hours (0 = unlimited)<br />
                <Text type="number" value={String(form.default_ttl_hours)}
                  onChange={(_, { value }) => set('default_ttl_hours', value)} style={{ width: 120 }} />
              </label>
              <Checkbox
                label="Auto-expire IOCs when TTL elapsed"
                checked={form.auto_expire}
                onChange={(_, { checked }) => set('auto_expire', checked)}
              />
              <label>Tags (comma-separated)<br />
                <Text value={form.tags} onChange={(_, { value }) => set('tags', value)} style={{ width: '100%' }} />
              </label>
            </div>
          </Modal.Body>
          <Modal.Footer>
            {saving ? <WaitSpinner /> : <Button appearance="primary" label="Save" onClick={save} />}
            <Button label="Cancel" onClick={closeForm} />
          </Modal.Footer>
        </Modal>
      )}

      {/* Delete confirm */}
      {delTarget && (
        <Modal open onRequestClose={() => setDelTarget(null)}>
          <Modal.Header title="Delete Policy" onRequestClose={() => setDelTarget(null)} />
          <Modal.Body>
            <p>Delete policy <strong>{delTarget.name}</strong>?</p>
            <p style={{ color: '#d41f1f' }}>IOCs assigned to this policy will lose the assignment.</p>
          </Modal.Body>
          <Modal.Footer>
            <Button appearance="destructive" label="Delete" onClick={confirmDelete} />
            <Button label="Cancel" onClick={() => setDelTarget(null)} />
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
