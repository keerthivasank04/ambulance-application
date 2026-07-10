import { expect } from 'chai';
import { createDriver } from '../drivers/driverFactory.js';
import DriverAppPage from '../pages/DriverAppPage.js';
import { DRIVER_CREDS } from '../config/env.js';

describe('Driver online/offline toggle', function () {
  let driver;
  let driverApp;

  before(async function () {
    driver = await createDriver();
    driverApp = new DriverAppPage(driver);
    await driverApp.open();
    await driverApp.login(DRIVER_CREDS.phone, DRIVER_CREDS.password);
  });

  after(async function () {
    await driver.quit();
  });

  it('flips availability status when the toggle button is clicked, and back again', async function () {
    const initial = await driverApp.statusBadgeText();

    await driverApp.toggleStatus();
    const toggled = await driver.wait(async () => {
      const text = await driverApp.statusBadgeText();
      return text !== initial ? text : null;
    }, 8000);
    expect(toggled).to.not.equal(initial);

    await driverApp.toggleStatus();
    const restored = await driver.wait(async () => {
      const text = await driverApp.statusBadgeText();
      return text === initial ? text : null;
    }, 8000);
    expect(restored).to.equal(initial);
  });
});
