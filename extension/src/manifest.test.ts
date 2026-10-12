import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));

test('toolbar action opens a persistent side panel with narrow permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel.default_path, 'panel.html');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'sidePanel', 'storage'].sort());
});
