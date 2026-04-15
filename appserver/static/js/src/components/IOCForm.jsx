/**
 * components/IOCForm.jsx
 * Form for creating and editing individual IOC entries.
 */

import React, { useState, useEffect } from 'react';
import Button   from '@splunk/react-ui/Button';
import Select   from '@splunk/react-ui/Select';
import Text     from '@splunk/react-ui/Text';
import Switch   from '@splunk/react-ui/Switch';
import Message  from '@splunk/react-ui/Message';

const EMPTY = {
  type: 'ip', value: '', list_type: 'block',
  policy_names: [], status: 'active',
  start_time: '', stop_time: '', description: '',
  source: 'manual', tags: '',
};

export default function IOCForm({ initial, policies, onSubmit, onCancel, loading }) {
  const isEdit = Boolean(initial?._key);
  const [form,   setForm]   = useState({ ...EMPTY, ...(initial || {}) });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (initial) setForm({ ...EMPTY, ...initial });
  }, [initial]);

  const set = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: null }));
  };

  const validate = () => {
    const e = {};
    if (!form.value.trim())         e.value       = 'Value is required';
    if (!form.type)                 e.type        = 'Type is required';
    if (!form.list_type)            e.list_type   = 'List type is required';
    if (!form.policy_names?.length) e.policy_names = 'At least one policy is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const payload = {
      ...form,
      tags: typeof form.tags === 'string'
        ? form.tags.split(',').map(t => t.trim()).filter(Boolean)
        : form.tags || [],
    };
    onSubmit(payload);
  };

  const field = (label, children, err) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label>
      {children}
      {err && <span style={{ color: '#c00', fontSize: 12 }}>{err}</span>}
    </div>
  );

  return (
    <div style={{ padding: 8 }}>
      {field('Type', (
        <Select value={form.type} onChange={(_, { value }) => set('type', value)} style={{ width: 160 }}>
          <Select.Option value="ip"     label="IP / CIDR" />
          <Select.Option value="url"    label="URL" />
          <Select.Option value="domain" label="Domain" />
        </Select>
      ), errors.type)}

      {field('Value', (
        <Text
          value={form.value}
          onChange={(_, { value }) => set('value', value)}
          placeholder={form.type === 'ip' ? '1.2.3.4 or 10.0.0.0/8' : form.type === 'url' ? 'https://evil.example.com/path' : 'evil.example.com'}
          style={{ width: '100%' }}
        />
      ), errors.value)}

      {field('List Type', (
        <Select value={form.list_type} onChange={(_, { value }) => set('list_type', value)} style={{ width: 160 }}>
          <Select.Option value="block" label="Block" />
          <Select.Option value="allow" label="Allow" />
        </Select>
      ), errors.list_type)}

      {field('Policies', (
        <Select
          multiple
          value={form.policy_names || []}
          onChange={(_, { values }) => set('policy_names', values)}
          style={{ width: 300 }}
        >
          {policies.map(p => (
            <Select.Option key={p._key} value={p.name} label={p.name} />
          ))}
        </Select>
      ), errors.policy_names)}

      {field('Status', (
        <Switch
          value={form.status === 'active'}
          onClick={() => set('status', form.status === 'active' ? 'inactive' : 'active')}
          selectedLabel="Active"
          unselectedLabel="Inactive"
        />
      ))}

      {field('Start Time (ISO 8601)', (
        <Text
          value={form.start_time || ''}
          onChange={(_, { value }) => set('start_time', value)}
          placeholder="2024-01-01T00:00:00Z"
          style={{ width: 220 }}
        />
      ))}

      {field('Stop Time (ISO 8601)', (
        <Text
          value={form.stop_time || ''}
          onChange={(_, { value }) => set('stop_time', value)}
          placeholder="2025-12-31T23:59:59Z"
          style={{ width: 220 }}
        />
      ))}

      {field('Description', (
        <Text
          value={form.description || ''}
          onChange={(_, { value }) => set('description', value)}
          style={{ width: '100%' }}
          multiline rows={2}
        />
      ))}

      {field('Tags (comma-separated)', (
        <Text
          value={typeof form.tags === 'string' ? form.tags : (form.tags || []).join(', ')}
          onChange={(_, { value }) => set('tags', value)}
          style={{ width: '100%' }}
        />
      ))}

      {field('Source', (
        <Text
          value={form.source || 'manual'}
          onChange={(_, { value }) => set('source', value)}
          style={{ width: 200 }}
        />
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button onClick={onCancel} label="Cancel" disabled={loading} />
        <Button
          appearance="primary"
          onClick={handleSubmit}
          disabled={loading}
          loading={loading}
          label={loading ? 'Saving…' : isEdit ? 'Save changes' : 'Add IOC'}
        />
      </div>
    </div>
  );
}
