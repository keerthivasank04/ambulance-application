import BasePage from './BasePage.js';

export default class AdminLoginPage extends BasePage {
  async open() {
    await super.open('/admin/login');
  }

  async login(username, password) {
    await this.typeTestId('admin-username-input', username);
    await this.typeTestId('admin-password-input', password);
    await this.clickTestId('admin-login-submit');
  }

  async errorText() {
    return this.textOfTestId('admin-login-error');
  }
}
