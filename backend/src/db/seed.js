const { getDb } = require('./database');

const hospitals = [
  { id:'H01', name:'Government General Hospital',           city:'Chennai',      address:'Park Town, Chennai - 600003',          lat:13.0827, lng:80.2707, phone:'044-25305000', emergency_available:1, icu_beds:50, specialties:'["Trauma","Cardiac","General","ICU"]' },
  { id:'H02', name:'Rajiv Gandhi Government Hospital',      city:'Chennai',      address:'Park Town, Chennai - 600003',          lat:13.0878, lng:80.2785, phone:'044-25305050', emergency_available:1, icu_beds:40, specialties:'["Multi-Specialty","Emergency","Neurology"]' },
  { id:'H03', name:'Stanley Medical College Hospital',      city:'Chennai',      address:'Old Jail Road, Chennai - 600001',      lat:13.1090, lng:80.2862, phone:'044-25285010', emergency_available:1, icu_beds:30, specialties:'["General","Trauma","Orthopedics"]' },
  { id:'H04', name:'Government Kilpauk Medical College',    city:'Chennai',      address:'Kilpauk, Chennai - 600010',            lat:13.0801, lng:80.2367, phone:'044-26422222', emergency_available:1, icu_beds:25, specialties:'["Neurology","Psychiatry","General"]' },
  { id:'H05', name:'ESI Hospital KK Nagar',                city:'Chennai',      address:'KK Nagar, Chennai - 600078',           lat:13.0451, lng:80.2102, phone:'044-22501051', emergency_available:1, icu_beds:20, specialties:'["General","Orthopedics"]' },
  { id:'H06', name:'Coimbatore Medical College Hospital',   city:'Coimbatore',   address:'Coimbatore - 641018',                  lat:11.0168, lng:76.9558, phone:'0422-2301393', emergency_available:1, icu_beds:45, specialties:'["Cardiac","General","Trauma","Neurology"]' },
  { id:'H07', name:'Government Rajaji Hospital',            city:'Madurai',      address:'Panagal Road, Madurai - 625020',       lat:9.9195,  lng:78.1195, phone:'0452-2532535', emergency_available:1, icu_beds:40, specialties:'["Multi-Specialty","Emergency","Cardiac"]' },
  { id:'H08', name:'Salem Government Hospital',             city:'Salem',        address:'Saradha College Road, Salem - 636016', lat:11.6543, lng:78.1460, phone:'0427-2411151', emergency_available:1, icu_beds:20, specialties:'["General","Orthopedics","Trauma"]' },
  { id:'H09', name:'Mahatma Gandhi Memorial Hospital',      city:'Trichy',       address:'Puthur, Trichy - 620017',              lat:10.7905, lng:78.7047, phone:'0431-2415050', emergency_available:1, icu_beds:30, specialties:'["General","Cardiac","Nephrology"]' },
  { id:'H10', name:'Government Hospital Vellore',           city:'Vellore',      address:'Vellore - 632004',                     lat:12.9202, lng:79.1325, phone:'0416-2281730', emergency_available:1, icu_beds:15, specialties:'["General","Neurology","Orthopedics"]' },
  { id:'H11', name:'Government Hospital Tirunelveli',       city:'Tirunelveli',  address:'Tirunelveli - 627002',                 lat:8.7139,  lng:77.7567, phone:'0462-2572766', emergency_available:1, icu_beds:18, specialties:'["General","Trauma","Pediatrics"]' },
  { id:'H12', name:'Government Hospital Erode',             city:'Erode',        address:'Erode - 638011',                       lat:11.3410, lng:77.7172, phone:'0424-2255555', emergency_available:1, icu_beds:12, specialties:'["General","Orthopedics"]' },
  { id:'H13', name:'Government Hospital Thanjavur',         city:'Thanjavur',    address:'Thanjavur - 613004',                   lat:10.7869, lng:79.1378, phone:'04362-228811', emergency_available:1, icu_beds:22, specialties:'["General","Cardiac","Gastroenterology"]' },
  { id:'H14', name:'Government Hospital Tiruppur',          city:'Tiruppur',     address:'Tiruppur - 641601',                    lat:11.1085, lng:77.3411, phone:'0421-2242222', emergency_available:1, icu_beds:10, specialties:'["General","Trauma"]' },
  { id:'H15', name:'Government Hospital Dindigul',          city:'Dindigul',     address:'Dindigul - 624001',                    lat:10.3624, lng:77.9695, phone:'0451-2432000', emergency_available:1, icu_beds:8,  specialties:'["General","Pediatrics"]' },
  { id:'H16', name:'Government Hospital Nagercoil',         city:'Nagercoil',    address:'Nagercoil - 629001',                   lat:8.1833,  lng:77.4119, phone:'04652-225555', emergency_available:1, icu_beds:10, specialties:'["General","Trauma"]' },
  { id:'H17', name:'Government Hospital Cuddalore',         city:'Cuddalore',    address:'Cuddalore - 607001',                   lat:11.7480, lng:79.7714, phone:'04142-235555', emergency_available:1, icu_beds:12, specialties:'["General"]' },
  { id:'H18', name:'Government Hospital Kumbakonam',        city:'Kumbakonam',   address:'Kumbakonam - 612001',                  lat:10.9601, lng:79.3845, phone:'0435-2423000', emergency_available:1, icu_beds:8,  specialties:'["General","Cardiac"]' },
];

// Each ambulance has a gps_device_id (flashed into Arduino EEPROM)
// and a sim_number (the SIM card in the SIM800L module)
const ambulances = [
  { id:'AMB001', registration_number:'TN01-AB-1234', type:'ALS', status:'available', current_lat:13.0670, current_lng:80.2371, base_hospital_id:'H01', gps_device_id:'ARD-001', sim_number:'9940000001' },
  { id:'AMB002', registration_number:'TN01-AB-5678', type:'BLS', status:'available', current_lat:13.0950, current_lng:80.2590, base_hospital_id:'H02', gps_device_id:'ARD-002', sim_number:'9940000002' },
  { id:'AMB003', registration_number:'TN01-CD-9012', type:'ALS', status:'available', current_lat:13.0540, current_lng:80.2440, base_hospital_id:'H01', gps_device_id:'ARD-003', sim_number:'9940000003' },
  { id:'AMB004', registration_number:'TN01-CD-3456', type:'ICU', status:'available', current_lat:13.1200, current_lng:80.2680, base_hospital_id:'H03', gps_device_id:'ARD-004', sim_number:'9940000004' },
  { id:'AMB005', registration_number:'TN01-EF-7890', type:'BLS', status:'available', current_lat:13.0310, current_lng:80.2200, base_hospital_id:'H05', gps_device_id:'ARD-005', sim_number:'9940000005' },
  { id:'AMB006', registration_number:'TN38-AA-0011', type:'ALS', status:'available', current_lat:11.0250, current_lng:76.9640, base_hospital_id:'H06', gps_device_id:'ARD-006', sim_number:'9940000006' },
  { id:'AMB007', registration_number:'TN38-AA-0022', type:'BLS', status:'available', current_lat:11.0050, current_lng:76.9400, base_hospital_id:'H06', gps_device_id:'ARD-007', sim_number:'9940000007' },
  { id:'AMB008', registration_number:'TN59-BB-1111', type:'ALS', status:'available', current_lat:9.9100,  current_lng:78.1300, base_hospital_id:'H07', gps_device_id:'ARD-008', sim_number:'9940000008' },
  { id:'AMB009', registration_number:'TN30-CC-2222', type:'BLS', status:'available', current_lat:11.6600, current_lng:78.1500, base_hospital_id:'H08', gps_device_id:'ARD-009', sim_number:'9940000009' },
  { id:'AMB010', registration_number:'TN45-DD-3333', type:'ALS', status:'available', current_lat:10.7850, current_lng:78.7100, base_hospital_id:'H09', gps_device_id:'ARD-010', sim_number:'9940000010' },
  { id:'AMB011', registration_number:'TN23-EE-4444', type:'BLS', status:'available', current_lat:12.9250, current_lng:79.1400, base_hospital_id:'H10', gps_device_id:'ARD-011', sim_number:'9940000011' },
  { id:'AMB012', registration_number:'TN76-FF-5555', type:'ALS', status:'available', current_lat:8.7200,  current_lng:77.7600, base_hospital_id:'H11', gps_device_id:'ARD-012', sim_number:'9940000012' },
  { id:'AMB013', registration_number:'TN26-GG-6666', type:'ICU', status:'available', current_lat:13.0700, current_lng:80.2600, base_hospital_id:'H02', gps_device_id:'ARD-013', sim_number:'9940000013' },
  { id:'AMB014', registration_number:'TN33-HH-7777', type:'BLS', status:'available', current_lat:10.9650, current_lng:79.3900, base_hospital_id:'H18', gps_device_id:'ARD-014', sim_number:'9940000014' },
  { id:'AMB015', registration_number:'TN19-II-8888', type:'ALS', status:'maintenance',current_lat:11.1100, current_lng:77.3450, base_hospital_id:'H14', gps_device_id:'ARD-015', sim_number:'9940000015' },
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
