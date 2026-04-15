# local/ — Local Configuration Overrides

Files placed in this directory override the app defaults without being
overwritten during upgrades. This directory is not included in the app
package distributed via Splunkbase.

---

## Files in this directory

### `authorize.conf`
Grant the `edl_read` and `edl_write` capabilities to your roles:
```ini
[role_soc_analyst]
edl_read = enabled

[role_soc_engineer]
edl_read  = enabled
edl_write = enabled
```

### `savedsearches.conf`
Enable the IOC Hit Tracker after configuring your firewall log sourcetype:
```ini
[EDL IOC Hit Tracker]
enableSched = 1
search = | inputlookup ioc_entries_lookup WHERE status="active" \\
          | rename value as ioc_value \\
          | join type=left ioc_value \\
              [search index=YOUR_INDEX sourcetype=YOUR_FIREWALL_SOURCETYPE action=deny earliest=-24h \\
              | stats count by dest_ip \\
              | rename dest_ip as ioc_value, count as hit_count_24h] \\
          | where isnotnull(hit_count_24h) \\
          | eval last_hit_at=strftime(now(), "%Y-%m-%dT%H:%M:%SZ") \\
          | table _key, hit_count_24h, last_hit_at
```

### Production hardening
Replace TAXII credential XOR obfuscation with Splunk storage/passwords.
See `06 - Development/` in the Obsidian vault for guidance.
