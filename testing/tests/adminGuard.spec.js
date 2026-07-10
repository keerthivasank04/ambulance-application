import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import AdminDashboardPage from '../pages/AdminDashboardPage.js';
import { BASE_URL } from '../config/env.js';

describe('Admin route guard', function () {
  let driver;
  let dashboard;

  before(async function () {
    driver = await createDriver();
    dashboard = new AdminDashboardPage(driver);
  });

  after(async function () {
    await driver.quit();
  });

  it('redirects unauthenticated visitors from /admin to /admin/login', async function () {
    await driver.get(`${BASE_URL}/`);
    await driver.executeScript('window.localStorage.removeItem("admin_token");');
    await dashboard.open();
    await dashboard.waitForUrlContains('/admin/login');
    const url = await dashboard.currentUrl();
    expect(url).to.include('/admin/login');
  });
});
