/**
 * The airports the first version of flights knew, kept for one job: moving the
 * flights it saved into the three tables (flightSchema.ts).
 *
 * Those flights were never looked up, so their cities, countries and positions
 * came from this table, and the table went when the status API took its place.
 * Moved without them, every such flight lost its stamp in the passport and its
 * arc on the map, and nothing could fill them in afterwards. It holds only what
 * the first version had: an airport it did not know stays unknown.
 *
 * Generated from src/flights/airports.ts as of 736e3cf. Nothing else may use
 * it: a flight added now gets these from the API.
 */

/** IATA → [city, ISO country, lat, lon] */
export const FIRST_VERSION_AIRPORTS: Readonly<Record<string, readonly [string, string, number, number]>> = {
  TPE: ['Taipei', 'TW', 25.0797, 121.2342],
  TSA: ['Taipei', 'TW', 25.0697, 121.5525],
  KHH: ['Kaohsiung', 'TW', 22.5714, 120.3503],
  RMQ: ['Taichung', 'TW', 24.2647, 120.6206],
  PVG: ['Shanghai', 'CN', 31.1443, 121.8083],
  SHA: ['Shanghai', 'CN', 31.1979, 121.3363],
  PEK: ['Beijing', 'CN', 40.0799, 116.6031],
  PKX: ['Beijing', 'CN', 39.5098, 116.4105],
  CAN: ['Guangzhou', 'CN', 23.3924, 113.2988],
  SZX: ['Shenzhen', 'CN', 22.6393, 113.8107],
  CTU: ['Chengdu', 'CN', 30.5785, 103.9471],
  HKG: ['Hong Kong', 'HK', 22.308, 113.9185],
  MFM: ['Macau', 'MO', 22.1496, 113.5916],
  NRT: ['Tokyo', 'JP', 35.772, 140.3929],
  HND: ['Tokyo', 'JP', 35.5494, 139.7798],
  KIX: ['Osaka', 'JP', 34.432, 135.2304],
  FUK: ['Fukuoka', 'JP', 33.5859, 130.4507],
  CTS: ['Sapporo', 'JP', 42.7752, 141.6923],
  OKA: ['Okinawa', 'JP', 26.1958, 127.6459],
  NGO: ['Nagoya', 'JP', 34.8584, 136.8053],
  ICN: ['Seoul', 'KR', 37.4602, 126.4407],
  GMP: ['Seoul', 'KR', 37.5582, 126.7906],
  PUS: ['Busan', 'KR', 35.1795, 128.9382],
  SIN: ['Singapore', 'SG', 1.3644, 103.9915],
  BKK: ['Bangkok', 'TH', 13.69, 100.7501],
  DMK: ['Bangkok', 'TH', 13.9126, 100.6067],
  KUL: ['Kuala Lumpur', 'MY', 2.7456, 101.7072],
  SGN: ['Ho Chi Minh City', 'VN', 10.8188, 106.6519],
  HAN: ['Hanoi', 'VN', 21.2212, 105.8072],
  MNL: ['Manila', 'PH', 14.5086, 121.0194],
  DPS: ['Denpasar', 'ID', -8.7482, 115.1672],
  LAX: ['Los Angeles', 'US', 33.9416, -118.4085],
  SFO: ['San Francisco', 'US', 37.6213, -122.379],
  SEA: ['Seattle', 'US', 47.4502, -122.3088],
  JFK: ['New York', 'US', 40.6413, -73.7781],
  EWR: ['Newark', 'US', 40.6895, -74.1745],
  ORD: ['Chicago', 'US', 41.9742, -87.9073],
  YVR: ['Vancouver', 'CA', 49.1967, -123.1815],
  LHR: ['London', 'GB', 51.47, -0.4543],
  CDG: ['Paris', 'FR', 49.0097, 2.5479],
  FRA: ['Frankfurt', 'DE', 50.0379, 8.5622],
  AMS: ['Amsterdam', 'NL', 52.3105, 4.7683],
  SYD: ['Sydney', 'AU', -33.9399, 151.1753],
  MEL: ['Melbourne', 'AU', -37.669, 144.841],
  AKL: ['Auckland', 'NZ', -37.0082, 174.785],
  DXB: ['Dubai', 'AE', 25.2532, 55.3657],
  DOH: ['Doha', 'QA', 25.2731, 51.6081],
};
