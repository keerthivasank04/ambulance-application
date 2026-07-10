import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import DriverAppPage from '../pages/DriverAppPage.js';
import { DRIVER_CREDS, DRIVER_CREDS_INVALID } from '../config/env.js';

describe('Driver login', function () {
  let driver;
  let driverApp;

  before(async function () {
    driver = await createDriver();
    driverApp = new DriverAppPage(driver);
  });

  after(async function () {
    await driver.quit();
  });

  it('shows an error for invalid credentials', async function () {
    await driverApp.open();
    await driverApp.login(DRIVER_CREDS_INVALID.phone, DRIVER_CREDS_INVALID.password);
    const error = await driverApp.errorText();
    expect(error).to.not.be.empty;
  });

  it('logs in with valid credentials and reaches the driver dashboard', async function () {
    await driverApp.open();
    await driverApp.login(DRIVER_CREDS.phone, DRIVER_CREDS.password);
    const name = await driverApp.driverName();
    expect(name).to.not.be.empty;
    await driverApp.signOut();
  });
});
