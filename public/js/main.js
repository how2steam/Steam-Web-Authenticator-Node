import { APIClient } from './modules/api.js';
import { UIManager } from './modules/ui-manager.js';
import { AccountManager } from './modules/account-manager.js';
import { GuardCodeDisplay } from './modules/guard-code.js';
import { ConfirmationsPanel } from './modules/confirmations.js';
import { SecurityPanel } from './modules/security.js';
import { SetupPanel } from './modules/setup.js';
import { ImportPanel } from './modules/import.js';

class SteamGuardApp {
  constructor() {
    this.ui = new UIManager();
    this.accounts = [];
    this.selectedAccount = null;
    this.isLoadingAccount = false;

    this.accountManager = new AccountManager(this.ui);
    this.guardCodeDisplay = null;
    this.confirmationsPanel = null;
    this.securityPanel = null;
  }

  async init() {
    this.renderLayout();
    await this.loadAccounts();
  }

  renderLayout() {
    const root = document.getElementById('appRoot');
    root.innerHTML = `
      <div class="app-layout">
        <div class="layout-header">
          <h1>🔐 Steam Guard</h1>
          <div class="subtitle">Authenticator Manager</div>
        </div>

        <div class="main-content">
          <div id="setupPanel"></div>
          <div id="importPanel"></div>
          <div id="accountsPanel"></div>
        </div>

        <div class="side-content">
          <div id="guardCodePanel"></div>
          <div id="confirmationsPanel"></div>
          <div id="securityPanel"></div>
        </div>
      </div>
    `;

    new SetupPanel().render(document.getElementById('setupPanel'));
    new ImportPanel(this).render(document.getElementById('importPanel'));
    this.guardCodeDisplay = new GuardCodeDisplay();
    this.confirmationsPanel = new ConfirmationsPanel(this.ui);
    this.securityPanel = new SecurityPanel(this.ui);
  }

  async loadAccounts() {
    try {
      this.accounts = await this.accountManager.loadAccounts();
      this.renderAccountsPanel();
    } catch (error) {
      this.ui.showError('Failed to load accounts: ' + error.message);
    }
  }

  renderAccountsPanel() {
    const container = document.getElementById('accountsPanel');
    container.innerHTML = `
      <div class="collapsible-panel expanded">
        <div class="panel-header">
          <div class="panel-header-title">
            <span>👤</span>
            <span>Your Accounts</span>
          </div>
          <div class="panel-toggle">▼</div>
        </div>
        <div class="panel-content">
          <div id="accountsList" class="accounts-grid"></div>
        </div>
      </div>
    `;

    const list = document.getElementById('accountsList');

    if (this.accounts.length === 0) {
      list.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">No accounts imported yet</div>';
      return;
    }

    this.accounts.forEach(acc => {
      const btn = document.createElement('button');
      btn.className = 'account-btn';
      btn.dataset.accountId = acc.id;
      btn.innerHTML = `
        <div class="account-name">${acc.account_name}</div>
        <div class="account-id">${acc.steamid}</div>
      `;
      btn.addEventListener('click', () => this.selectAccount(acc));
      list.appendChild(btn);
    });

    const header = container.querySelector('.panel-header');
    header.addEventListener('click', () => {
      const panel = container.querySelector('.collapsible-panel');
      panel.classList.toggle('collapsed');
      panel.classList.toggle('expanded');
    });
  }

  async selectAccount(account) {
    if (this.isLoadingAccount) return;
    this.isLoadingAccount = true;

    try {
      this.selectedAccount = account;

      document.querySelectorAll('.account-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.accountId === account.id);
      });

      this.clearSideContent();
      this.showLoadingState();

      const sessionValid = await this.validateSession(account);

      if (!sessionValid) {
        await this.showLoginForm(account);
        return;
      }

      await this.loadAccountData(account);
    } catch (error) {
      this.ui.showError('Error loading account: ' + error.message);
      this.clearSideContent();
    } finally {
      this.isLoadingAccount = false;
    }
  }

  showLoadingState() {
    const guardPanel = document.getElementById('guardCodePanel');
    guardPanel.innerHTML = `
      <div class="collapsible-panel expanded">
        <div class="panel-header">
          <div class="panel-header-title">
            <span>🔐</span>
            <span>Validating Session</span>
          </div>
        </div>
        <div class="panel-content">
          <div style="padding: 20px; text-align: center;">
            <div class="spinner" style="margin: 0 auto 10px;"></div>
            <div style="color: var(--text-secondary);">Checking session validity...</div>
          </div>
        </div>
      </div>
    `;
  }

  async validateSession(account) {
    try {
      const validation = await APIClient.validateSession(account.id);

      if (validation.valid) {
        return true;
      } else {
        let message = 'Session validation failed';
        if (validation.reason === 'NO_SESSION') {
          message = 'No session found. Please login.';
        } else if (validation.reason === 'SESSION_EXPIRED') {
          message = 'Session expired. Please login again.';
        } else if (validation.reason === 'INCOMPLETE_SESSION') {
          message = 'Session data incomplete. Please login again.';
        }

        this.ui.showWarning(message);
        return false;
      }
    } catch (error) {
      this.ui.showWarning('Session validation failed. Please login.');
      return false;
    }
  }

  clearSideContent() {
    document.getElementById('guardCodePanel').innerHTML = '';
    document.getElementById('confirmationsPanel').innerHTML = '';
    document.getElementById('securityPanel').innerHTML = '';
  }

  async showLoginForm(account) {
    let sessionInfo = null;
    try {
      sessionInfo = await APIClient.getSessionInfo(account.id);
    } catch (e) {
      console.error('[App] Failed to fetch session info:', e);
    }

    let sessionMessage = '';
    if (sessionInfo?.age) {
      if (sessionInfo.reason === 'SESSION_EXPIRED') {
        sessionMessage = `
          <div style="background: var(--bg-tertiary); padding: 10px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid var(--color-warning);">
            <div style="font-size: 0.85rem; color: var(--text-secondary);">
              Session expired after ${sessionInfo.age.ageFormatted} of inactivity.
            </div>
          </div>
        `;
      }
    }

    const container = document.getElementById('guardCodePanel');
    container.innerHTML = `
      <div class="collapsible-panel expanded">
        <div class="panel-header">
          <div class="panel-header-title">
            <span>🔐</span>
            <span>Session Required</span>
          </div>
        </div>
        <div class="panel-content">
          <div style="padding: 20px; background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%); border: 2px solid var(--color-primary); border-radius: 8px;">
            <h4 style="margin: 0 0 15px 0; color: var(--color-primary);">🔓 Login Required</h4>
            
            ${sessionMessage}
            
            <p style="margin: 0 0 15px 0; font-size: 0.95rem; color: var(--text-secondary);">
              Enter your Steam password to create a session:
            </p>

            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 6px; margin-bottom: 15px; border-left: 3px solid var(--color-primary);">
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 4px;">Account</div>
              <div style="font-weight: 600; color: var(--text-primary);">${account.account_name}</div>
            </div>

            <input 
              type="password" 
              id="loginPassword" 
              placeholder="Enter your Steam password" 
              autocomplete="off"
              style="width: 100%; padding: 10px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.95rem; margin-bottom: 12px;"
            />

            <button 
              id="loginBtn" 
              style="width: 100%; padding: 12px; background: var(--color-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;"
            >
              🔓 Login & Load Account
            </button>

            <div id="loginStatus" style="margin-top: 12px;"></div>
            
            <p style="margin: 15px 0 0 0; font-size: 0.75rem; color: var(--text-tertiary); text-align: center; border-top: 1px solid var(--border-primary); padding-top: 12px;">
              Sessions remain active for 30 days with regular use
            </p>
          </div>
        </div>
      </div>
    `;

    const loginBtn = document.getElementById('loginBtn');
    const passwordInput = document.getElementById('loginPassword');
    const statusDiv = document.getElementById('loginStatus');

    const handleLogin = async () => {
      const password = passwordInput.value.trim();
      if (!password) {
        statusDiv.innerHTML = '<div class="status-message status-error">Password required</div>';
        return;
      }

      loginBtn.disabled = true;
      statusDiv.innerHTML = '<div class="status-message status-info">⏳ Logging in...</div>';

      try {
        await APIClient.refreshSession(account.id, password);
        statusDiv.innerHTML = '<div class="status-message status-success">✓ Login successful! Loading account...</div>';
        passwordInput.value = '';

        setTimeout(() => {
          this.selectAccount(account);
        }, 1000);
      } catch (error) {
        statusDiv.innerHTML = `<div class="status-message status-error">❌ Login failed: ${error.message}</div>`;
        loginBtn.disabled = false;
      }
    };

    loginBtn.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') handleLogin();
    });
  }

  async loadAccountData(account) {
    try {
      this.guardCodeDisplay.render(
        document.getElementById('guardCodePanel'),
        account
      );
      await this.guardCodeDisplay.start(account);

      this.confirmationsPanel.render(
        document.getElementById('confirmationsPanel'),
        account
      );
      await this.confirmationsPanel.loadWithRetry(account);

      this.securityPanel.render(
        document.getElementById('securityPanel'),
        account
      );
      await this.securityPanel.loadWithRetry(account);

      this.ui.showSuccess(`Loaded: ${account.account_name}`);
    } catch (error) {
      if (error.message === 'LOGIN_REQUIRED') {
        this.ui.showError('Session expired. Please login again.');
        await this.showLoginForm(account);
      } else {
        this.ui.showError('Error loading account data: ' + error.message);
      }
    }
  }

  async importAccount(maFileContent) {
    try {
      await this.accountManager.importAccount(maFileContent);
      await this.loadAccounts();
      this.ui.showSuccess('Account imported successfully!');
    } catch (error) {
      this.ui.showError('Import failed: ' + error.message);
    }
  }
}

const app = new SteamGuardApp();
app.init();
window.app = app;
