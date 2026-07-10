import BasePage from './BasePage.js';

export default class DriverAppPage extends BasePage {
  async open() {
    await super.open('/driver');
  }

  async login(phone, password) {
    await this.typeTestId('driver-phone-input', phone);
    await this.typeTestId('driver-password-input', password);
    await this.clickTestId('driver-login-submit');
  }

  async errorText() {
    return this.textOfTestId('driver-login-error');
  }

  async driverName() {
    return this.textOfTestId('driver-name');
  }

  async statusBadgeText() {
    return this.textOfTestId('driver-status-badge');
  }

  async toggleStatus() {
    await this.clickTestId('driver-toggle-status');
  }

  async signOut() {
    await this.clickTestId('driver-signout');
  }
}
