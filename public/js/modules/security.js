import { APIClient } from './api.js';

export class SecurityPanel {
  constructor(ui) {
    this.ui = ui;
    this.currentAccount = null;
  }

  render(container, account) {
    container.innerHTML = `
      <div class="collapsible-panel expanded">
        <div class="panel-header">
          <div class="panel-header-title">
            <span>🛡️</span>
            <span>Security & Settings</span>
          </div>
        </div>
        <div class="panel-content">
          <div id="securityContent"></div>
        </div>
      </div>
    `;
  }

  async loadWithRetry(account) {
    try {
      await this.load(account);
    } catch (error) {
      if (error.message === 'LOGIN_REQUIRED' || error.status === 401) {
        throw new Error('LOGIN_REQUIRED');
      }
      throw error;
    }
  }

  async load(account) {
    this.currentAccount = account;
    const container = document.getElementById('securityContent');

    container.innerHTML = '<div class="loading-state"><div class="spinner"></div> Loading security info...</div>';

    try {
      const status = await APIClient.getSecurityStatus(account.id);
      const devices = await APIClient.getDevices(account.steamid);

      let html = `
        <div style="background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h5 style="margin: 0 0 10px 0; font-size: 0.9rem; color: var(--text-secondary);">Account Information</h5>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 3px;">📛 Account Name</div>
              <div style="font-weight: 600; color: var(--text-primary);">${account.account_name}</div>
            </div>
            <div>
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 3px;">🔢 Steam ID</div>
              <div style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem; word-break: break-all;">${account.steamid}</div>
            </div>
          </div>
        </div>

        <h5 style="margin: 0 0 12px 0; font-size: 0.9rem; color: var(--text-secondary);">Security Status</h5>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
          <div style="padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.05em;">🔐 Authenticator</div>
            <div style="font-weight: 700; font-size: 1.1rem; color: ${status.authenticatorEnabled ? 'var(--color-success)' : 'var(--color-error)'};">
              ${status.authenticatorEnabled ? '✓ Enabled' : '✗ Disabled'}
            </div>
          </div>

          <div style="padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.05em;">📱 Phone</div>
            <div>
              <div style="font-weight: 700; font-size: 1.1rem; color: ${status.phoneNumber ? 'var(--color-success)' : 'var(--color-error)'};">
                ${status.phoneNumber ? '✓ Verified' : '✗ Not Set'}
              </div>
              ${status.phoneNumberValue ? `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">${status.phoneNumberValue}</div>` : ''}
            </div>
          </div>

          <div style="padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.05em;">💾 Recovery</div>
            <div style="font-weight: 700; font-size: 1.1rem; color: ${status.revocationCodeAvailable ? 'var(--color-success)' : 'var(--color-warning)'};">
              ${status.revocationCodeAvailable ? '✓ Available' : '⚠ Missing'}
            </div>
          </div>

          <div style="padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.05em;">💱 Trading</div>
            <div style="font-weight: 700; font-size: 1.1rem; color: ${status.tradingEnabled ? 'var(--color-success)' : 'var(--color-warning)'};">
              ${status.tradingEnabled ? '✓ Enabled' : '⚠ Disabled'}
            </div>
          </div>
        </div>

        <h5 style="margin: 0 0 12px 0; font-size: 0.9rem; color: var(--text-secondary);">🔗 Authorized Devices (${devices.length})</h5>
        <div id="devicesContainer" style="display: grid; gap: 12px;">
      `;

      if (devices.length > 0) {
        devices.forEach(device => {
          const icon = this.getDeviceIcon(device.type);

          html += `
            <div style="padding: 15px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px; display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: start;">
              <div style="font-size: 2rem; text-align: center;">${icon}</div>
              <div>
                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 6px; word-break: break-word;">${device.name}</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem; color: var(--text-secondary);">
                  <div>
                    <div style="margin-bottom: 2px;">📍 Location</div>
                    <div style="color: var(--text-primary);">${device.location}</div>
                  </div>
                  <div>
                    <div style="margin-bottom: 2px;">⏱ Last Used</div>
                    <div style="color: var(--text-primary);">${device.lastUsed}</div>
                  </div>
                </div>
              </div>
              <div>
                <button class="device-remove-btn" data-device-id="${device.id}" style="padding: 8px 12px; background: var(--color-error); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; white-space: nowrap;">
                  Remove
                </button>
              </div>
            </div>
          `;
        });
      } else {
        html += `
          <div style="padding: 20px; background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%); border: 1px solid var(--border-primary); border-radius: 6px; text-align: center; color: var(--text-secondary);">
            No authorized devices found
          </div>
        `;
      }

      html += `
        </div>
        <div style="margin-top: 15px; display: flex; gap: 10px;">
          <button 
            id="refreshSecurityBtn" 
            class="secondary" 
            style="flex: 1; padding: 10px;"
          >
            🔄 Refresh
          </button>
          <button 
            id="removeAllDevicesBtn" 
            class="secondary" 
            style="flex: 1; padding: 10px; background: var(--color-warning); color: white;"
          >
            🗑️ Remove All Devices
          </button>
        </div>
      `;

      container.innerHTML = html;

      document.getElementById('refreshSecurityBtn').addEventListener('click', () => {
        this.loadWithRetry(this.currentAccount);
      });

      document.getElementById('removeAllDevicesBtn').addEventListener('click', () => {
        this.showRemoveAllConfirmation();
      });

      document.querySelectorAll('.device-remove-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          const deviceId = e.target.getAttribute('data-device-id');
          const deviceDiv = e.target.closest('[style*="grid-template-columns"]');
          const deviceName = deviceDiv.querySelector('div:nth-child(2) > div:first-child').textContent;
          this.showRemoveDeviceConfirmation(deviceId, deviceName);
        });
      });
    } catch (error) {
      if (error.message === 'LOGIN_REQUIRED' || error.status === 401) {
        container.innerHTML = `
          <div style="padding: 20px; background: #371f1f; border: 1px solid #7f1d1d; border-radius: 6px; text-align: center;">
            <div style="color: var(--color-error); margin-bottom: 8px;">⚠️ Session Expired</div>
            <div style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 10px;">
              Your session has expired. Please refresh the account to login again.
            </div>
          </div>
        `;
        throw new Error('LOGIN_REQUIRED');
      }

      container.innerHTML = `
        <div style="padding: 20px; background: #371f1f; border: 1px solid #7f1d1d; border-radius: 6px; text-align: center;">
          <div style="color: var(--color-error); margin-bottom: 8px;">⚠️ Error Loading Security Info</div>
          <div style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 10px;">${error.message}</div>
          <button class="secondary" onclick="window.app.selectAccount(window.app.selectedAccount)" style="width: 100%;">
            Retry
          </button>
        </div>
      `;
    }
  }

  getDeviceIcon(type) {
    switch (type) {
      case 'mobile':
        return '📱';
      case 'web':
        return '🌐';
      case 'desktop':
        return '🖥️';
      default:
        return '🔗';
    }
  }

  showRemoveDeviceConfirmation(deviceId, deviceName) {
    const message = `Are you sure you want to remove "${deviceName}"?`;
    if (confirm(message)) {
      this.removeDevice(deviceId, deviceName);
    }
  }

  showRemoveAllConfirmation() {
    const message = `Are you sure you want to remove ALL authorized devices? This will sign you out of all devices.`;
    if (confirm(message)) {
      this.removeAllDevices();
    }
  }

  async removeDevice(deviceId, deviceName) {
    try {
      await APIClient.removeDevice(this.currentAccount.steamid, deviceId);
      this.ui.showSuccess(`Device "${deviceName}" removed successfully`);
      this.loadWithRetry(this.currentAccount);
    } catch (error) {
      if (error.message === 'LOGIN_REQUIRED' || error.status === 401) {
        this.ui.showError('Session expired. Please refresh the account.');
        throw new Error('LOGIN_REQUIRED');
      }
      this.ui.showError(`Failed to remove device: ${error.message}`);
    }
  }

  async removeAllDevices() {
    try {
      const response = await APIClient.removeAllDevices(this.currentAccount.steamid);
      this.ui.showSuccess(`Removed ${response.removed} device${response.removed !== 1 ? 's' : ''}`);
      this.loadWithRetry(this.currentAccount);
    } catch (error) {
      if (error.message === 'LOGIN_REQUIRED' || error.status === 401) {
        this.ui.showError('Session expired. Please refresh the account.');
        throw new Error('LOGIN_REQUIRED');
      }
      this.ui.showError(`Failed to remove devices: ${error.message}`);
    }
  }
}
