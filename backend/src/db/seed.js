const { getDb } = require('./database');

// Chennai-only service area — every hospital below is a real facility
// within Chennai city / the immediate metropolitan area.
const hospitals = [
  { id:'H01', name:'Government General Hospital',                 city:'Chennai', address:'Park Town, Chennai - 600003',           lat:13.0827, lng:80.2707, phone:'044-25305000', emergency_available:1, icu_beds:50, specialties:'["Trauma","Cardiac","General","ICU"]' },
  { id:'H02', name:'Government Royapettah Hospital',               city:'Chennai', address:'Royapettah, Chennai - 600014',          lat:13.0524, lng:80.2634, phone:'044-28480500', emergency_available:1, icu_beds:25, specialties:'["General","Trauma","Orthopedics"]' },
  { id:'H03', name:'Stanley Medical College Hospital',             city:'Chennai', address:'Old Jail Road, Chennai - 600001',       lat:13.1090, lng:80.2862, phone:'044-25285010', emergency_available:1, icu_beds:30, specialties:'["General","Trauma","Orthopedics"]' },
  { id:'H04', name:'Government Kilpauk Medical College',           city:'Chennai', address:'Kilpauk, Chennai - 600010',             lat:13.0801, lng:80.2367, phone:'044-26422222', emergency_available:1, icu_beds:25, specialties:'["Neurology","Psychiatry","General"]' },
  { id:'H05', name:'ESI Hospital KK Nagar',                        city:'Chennai', address:'KK Nagar, Chennai - 600078',            lat:13.0451, lng:80.2102, phone:'044-22501051', emergency_available:1, icu_beds:20, specialties:'["General","Orthopedics"]' },
  { id:'H06', name:'Government Omandurar Medical College Hospital', city:'Chennai', address:'Omandurar Estate, Chennai - 600002',    lat:13.0693, lng:80.2652, phone:'044-25341556', emergency_available:1, icu_beds:28, specialties:'["Multi-Specialty","Emergency","General"]' },
  { id:'H07', name:'Institute of Child Health (Egmore)',           city:'Chennai', address:'Halls Road, Egmore, Chennai - 600008',  lat:13.0732, lng:80.2609, phone:'044-28191476', emergency_available:1, icu_beds:15, specialties:'["Pediatrics","General"]' },
  { id:'H08', name:'Government Hospital, Tambaram Sanatorium',     city:'Chennai', address:'Tambaram, Chennai - 600047',            lat:12.9246, lng:80.1000, phone:'044-22391235', emergency_available:1, icu_beds:12, specialties:'["General","Trauma"]' },
  { id:'H09', name:'Sri Ramachandra Medical Centre',               city:'Chennai', address:'Porur, Chennai - 600116',               lat:13.0374, lng:80.1575, phone:'044-45928500', emergency_available:1, icu_beds:35, specialties:'["Cardiac","Multi-Specialty","Trauma","Neurology"]' },
  { id:'H10', name:'Government Peripheral Hospital, Anna Nagar',   city:'Chennai', address:'Anna Nagar, Chennai - 600040',          lat:13.0850, lng:80.2101, phone:'044-26161266', emergency_available:1, icu_beds:14, specialties:'["General","Orthopedics"]' },
];

// Each ambulance has a gps_device_id (flashed into Arduino EEPROM)
// and a sim_number (the SIM card in the SIM800L module)
// All 15 units are based at Chennai hospitals and positioned within city limits.
const ambulances = [
  { id:'AMB001', registration_number:'TN01-AB-1234', type:'ALS', status:'available', current_lat:13.0670, current_lng:80.2371, base_hospital_id:'H01', gps_device_id:'ARD-001', sim_number:'9940000001' },
  { id:'AMB002', registration_number:'TN01-AB-5678', type:'BLS', status:'available', current_lat:13.0500, current_lng:80.2650, base_hospital_id:'H02', gps_device_id:'ARD-002', sim_number:'9940000002' },
  { id:'AMB003', registration_number:'TN01-CD-9012', type:'ALS', status:'available', current_lat:13.0540, current_lng:80.2440, base_hospital_id:'H01', gps_device_id:'ARD-003', sim_number:'9940000003' },
  { id:'AMB004', registration_number:'TN01-CD-3456', type:'ICU', status:'available', current_lat:13.1200, current_lng:80.2680, base_hospital_id:'H03', gps_device_id:'ARD-004', sim_number:'9940000004' },
  { id:'AMB005', registration_number:'TN01-EF-7890', type:'BLS', status:'available', current_lat:13.0310, current_lng:80.2200, base_hospital_id:'H05', gps_device_id:'ARD-005', sim_number:'9940000005' },
  { id:'AMB006', registration_number:'TN02-AA-0011', type:'ALS', status:'available', current_lat:13.0650, current_lng:80.2600, base_hospital_id:'H06', gps_device_id:'ARD-006', sim_number:'9940000006' },
  { id:'AMB007', registration_number:'TN02-AA-0022', type:'BLS', status:'available', current_lat:13.0720, current_lng:80.2680, base_hospital_id:'H06', gps_device_id:'ARD-007', sim_number:'9940000007' },
  { id:'AMB008', registration_number:'TN04-BB-1111', type:'ALS', status:'available', current_lat:13.0700, current_lng:80.2580, base_hospital_id:'H07', gps_device_id:'ARD-008', sim_number:'9940000008' },
  { id:'AMB009', registration_number:'TN07-CC-2222', type:'BLS', status:'available', current_lat:12.9280, current_lng:80.1050, base_hospital_id:'H08', gps_device_id:'ARD-009', sim_number:'9940000009' },
  { id:'AMB010', registration_number:'TN09-DD-3333', type:'ALS', status:'available', current_lat:13.0400, current_lng:80.1600, base_hospital_id:'H09', gps_device_id:'ARD-010', sim_number:'9940000010' },
  { id:'AMB011', registration_number:'TN10-EE-4444', type:'BLS', status:'available', current_lat:13.0880, current_lng:80.2130, base_hospital_id:'H10', gps_device_id:'ARD-011', sim_number:'9940000011' },
  { id:'AMB012', registration_number:'TN11-FF-5555', type:'ALS', status:'available', current_lat:13.0550, current_lng:80.2660, base_hospital_id:'H02', gps_device_id:'ARD-012', sim_number:'9940000012' },
  { id:'AMB013', registration_number:'TN01-GG-6666', type:'ICU', status:'available', current_lat:13.0700, current_lng:80.2600, base_hospital_id:'H01', gps_device_id:'ARD-013', sim_number:'9940000013' },
  { id:'AMB014', registration_number:'TN12-HH-7777', type:'BLS', status:'available', current_lat:13.0820, current_lng:80.2070, base_hospital_id:'H10', gps_device_id:'ARD-014', sim_number:'9940000014' },
  { id:'AMB015', registration_number:'TN18-II-8888', type:'ALS', status:'maintenance',current_lat:12.9200, current_lng:80.0980, base_hospital_id:'H08', gps_device_id:'ARD-015', sim_number:'9940000015' },
];

const drivers = [
  { id:'DRV001', name:'Murugan Selvam',     phone:'9444001001', email:'murugan@tnambulance.in',    license_number:'TN-DL-001', experience_years:8,  rating:4.8, ambulance_id:'AMB001', status:'online',  password:'pass123' },
  { id:'DRV002', name:'Rajan Krishnan',     phone:'9444001002', email:'rajan@tnambulance.in',      license_number:'TN-DL-002', experience_years:5,  rating:4.6, ambulance_id:'AMB002', status:'online',  password:'pass123' },
  { id:'DRV003', name:'Senthil Kumar',      phone:'9444001003', email:'senthil@tnambulance.in',    license_number:'TN-DL-003', experience_years:10, rating:4.9, ambulance_id:'AMB003', status:'online',  password:'pass123' },
  { id:'DRV004', name:'Priya Devi',         phone:'9444001004', email:'priya@tnambulance.in',      license_number:'TN-DL-004', experience_years:3,  rating:4.5, ambulance_id:'AMB004', status:'online',  password:'pass123' },
  { id:'DRV005', name:'Kavitha Ramesh',     phone:'9444001005', email:'kavitha@tnambulance.in',    license_number:'TN-DL-005', experience_years:4,  rating:4.4, ambulance_id:'AMB005', status:'offline', password:'pass123' },
  { id:'DRV006', name:'Anand Subramanian',  phone:'9444001006', email:'anand@tnambulance.in',      license_number:'TN-DL-006', experience_years:7,  rating:4.7, ambulance_id:'AMB006', status:'online',  password:'pass123' },
  { id:'DRV007', name:'Kavindra Raj',       phone:'9444001007', email:'kavindra@tnambulance.in',   license_number:'TN-DL-007', experience_years:4,  rating:4.4, ambulance_id:'AMB007', status:'online',  password:'pass123' },
  { id:'DRV008', name:'Siva Prakash',       phone:'9444001008', email:'siva@tnambulance.in',       license_number:'TN-DL-008', experience_years:9,  rating:4.8, ambulance_id:'AMB008', status:'online',  password:'pass123' },
  { id:'DRV009', name:'Arun Pandian',       phone:'9444001009', email:'arun@tnambulance.in',       license_number:'TN-DL-009', experience_years:6,  rating:4.6, ambulance_id:'AMB009', status:'online',  password:'pass123' },
  { id:'DRV010', name:'Lakshmi Nathan',     phone:'9444001010', email:'lakshmi@tnambulance.in',    license_number:'TN-DL-010', experience_years:11, rating:4.9, ambulance_id:'AMB010', status:'online',  password:'pass123' },
  { id:'DRV011', name:'Deepan Raj',         phone:'9444001011', email:'deepan@tnambulance.in',     license_number:'TN-DL-011', experience_years:2,  rating:4.3, ambulance_id:'AMB011', status:'offline', password:'pass123' },
  { id:'DRV012', name:'Karthik Varma',      phone:'9444001012', email:'karthik@tnambulance.in',    license_number:'TN-DL-012', experience_years:6,  rating:4.7, ambulance_id:'AMB012', status:'online',  password:'pass123' },
  { id:'DRV013', name:'Sasikala Mohan',     phone:'9444001013', email:'sasikala@tnambulance.in',   license_number:'TN-DL-013', experience_years:5,  rating:4.5, ambulance_id:'AMB013', status:'online',  password:'pass123' },
  { id:'DRV014', name:'Vijay Annamalai',    phone:'9444001014', email:'vijay@tnambulance.in',      license_number:'TN-DL-014', experience_years:3,  rating:4.2, ambulance_id:'AMB014', status:'online',  password:'pass123' },
];

function seed() {
  const db = getDb();

  const existingHospitals = db.prepare('SELECT COUNT(*) as c FROM hospitals').get();
  if (existingHospitals.c > 0) {
    // Patch device IDs onto existing rows (migration-safe)
    const patchDevice = db.prepare(`UPDATE ambulances SET gps_device_id=@gps_device_id, sim_number=@sim_number WHERE id=@id AND gps_device_id IS NULL`);
    db.transaction(() => ambulances.forEach(a => patchDevice.run(a)))();
    console.log('[seed] already seeded — patched device IDs if missing.');
    return;
  }

  const insertHospital  = db.prepare(`INSERT OR IGNORE INTO hospitals (id,name,city,address,lat,lng,phone,emergency_available,icu_beds,specialties) VALUES (@id,@name,@city,@address,@lat,@lng,@phone,@emergency_available,@icu_beds,@specialties)`);
  const insertAmbulance = db.prepare(`INSERT OR IGNORE INTO ambulances (id,registration_number,type,status,current_lat,current_lng,base_hospital_id,gps_device_id,sim_number) VALUES (@id,@registration_number,@type,@status,@current_lat,@current_lng,@base_hospital_id,@gps_device_id,@sim_number)`);
  const insertDriver    = db.prepare(`INSERT OR IGNORE INTO drivers (id,name,phone,email,license_number,experience_years,rating,ambulance_id,status,password) VALUES (@id,@name,@phone,@email,@license_number,@experience_years,@rating,@ambulance_id,@status,@password)`);

  db.transaction(() => {
    hospitals.forEach(h => insertHospital.run(h));
    ambulances.forEach(a => insertAmbulance.run(a));
    drivers.forEach(d => insertDriver.run(d));
  })();

  console.log(`[seed] ${hospitals.length} hospitals, ${ambulances.length} ambulances, ${drivers.length} drivers`);
}

module.exports = { seed };
