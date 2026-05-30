# EDL Manager — Test Results

Newman (Postman CLI) test run outputs are stored here as JSON.

## Naming convention
```
baseline_YYYY-MM-DD.json   — known-good snapshot after a major milestone
run_YYYY-MM-DD.json        — routine test run
regression_YYYY-MM-DD.json — regression check after a change
```

## How to run
```powershell
newman run tests/EDL_Manager.postman_collection.json `
  --env-var "base_url=https://localhost:8089" `
  --env-var "username=admin" `
  --env-var "password=YOUR_PASSWORD" `
  --insecure `
  --reporters cli,json `
  --reporter-json-export tests/results/run_$(Get-Date -Format yyyy-MM-dd).json
```

## Baseline
`baseline_2026-05-30.json` — All Postman tests passing after:
- PSCA POST body discovery (form-encoded payload key)
- React chunk fix (static d3 import)
- Tab switching fix (activePanelId)
- Policy CRUD working end-to-end
- Conflict detection working
- Feed endpoint serving IOCs
- Token CRUD working
- All 19 endpoints verified on Splunk 10.4.0
