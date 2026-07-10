import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import AdminLoginPage from '../pages/AdminLoginPage.js';
import AdminDashboardPage from '../pages/AdminDashboardPage.js';
import { ADMIN_CREDS, ADMIN_CREDS_INVALID } from '../config/env.js';

describe('Admin login', function () {
  let driver;
  let loginPage;

  before(async function () {
    driver = await createDriver();
    loginPage = new AdminLoginPage(driver);
  });

  after(async function () {
    await driver.quit();
  });

  beforeEach(async function () {
    await loginPage.open();
    await driver.executeScript('window.localStorage.clear();');
    await loginPage.open();
  });

  it('shows an error for invalid credentials', async function () {
    await loginPage.login(ADMIN_CREDS_INVALID.username, ADMIN_CREDS_INVALID.password);
    const error = await loginPage.errorText();
    expect(error).to.not.be.empty;
    const url = await loginPage.currentUrl();
    expect(url).to.include('/admin/login');
  });

  it('logs in with valid credentials and reaches the control room', async function () {
    await loginPage.login(ADMIN_CREDS.username, ADMIN_CREDS.password);
    await loginPage.waitForUrlContains('/admin');
    const dashboard = new AdminDashboardPage(driver);
    const header = await dashboard.headerText();
    expect(header).to.include('Fleet Operations Control Room');
    expect(await dashboard.isTabVisible(0)).to.be.true;
  });
});
