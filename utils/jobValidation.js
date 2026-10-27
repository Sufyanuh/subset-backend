// utils/jobValidation.js

export const COUNTRIES = [
  "Worldwide",
  "Andorra",
  "United Arab Emirates",
  "Afghanistan",
  "Antigua and Barbuda",
  "Anguilla",
  "Albania",
  "Armenia",
  "Angola",
  "Antarctica",
  "Argentina",
  "American Samoa",
  "Austria",
  "Australia",
  "Aruba",
  "Alland Islands",
  "Azerbaijan",
  "Bosnia and Herzegovina",
  "Barbados",
  "Bangladesh",
  "Belgium",
  "Burkina Faso",
  "Bulgaria",
  "Bahrain",
  "Burundi",
  "Benin",
  "Saint Barthelemy",
  "Bermuda",
  "Brunei Darussalam",
  "Bolivia",
  "Brazil",
  "Bahamas",
  "Bhutan",
  "Bouvet Island",
  "Botswana",
  "Belarus",
  "Belize",
  "Canada",
  "Cocos (Keeling) Islands",
  "Congo, Democratic Republic of the",
  "Central African Republic",
  "Congo, Republic of the",
  "Switzerland",
  "Cote d'Ivoire",
  "Cook Islands",
  "Chile",
  "Cameroon",
  "China",
  "Colombia",
  "Costa Rica",
  "Cuba",
  "Cape Verde",
  "Curacao",
  "Christmas Island",
  "Cyprus",
  "Czech Republic",
  "Germany",
  "Djibouti",
  "Denmark",
  "Dominica",
  "Dominican Republic",
  "Algeria",
  "Ecuador",
  "Estonia",
  "Egypt",
  "Western Sahara",
  "Eritrea",
  "Spain",
  "Ethiopia",
  "Finland",
  "Fiji",
  "Falkland Islands (Malvinas)",
  "Micronesia, Federated States of",
  "Faroe Islands",
  "France",
  "Gabon",
  "United Kingdom",
  "Grenada",
  "Georgia",
  "French Guiana",
  "Guernsey",
  "Ghana",
  "Gibraltar",
  "Greenland",
  "Gambia",
  "Guinea",
  "Guadeloupe",
  "Equatorial Guinea",
  "Greece",
  "South Georgia and the South Sandwich Islands",
  "Guatemala",
  "Guam",
  "Guinea-Bissau",
  "Guyana",
  "Hong Kong",
  "Heard Island and McDonald Islands",
  "Honduras",
  "Croatia",
  "Haiti",
  "Hungary",
  "Indonesia",
  "Ireland",
  "Israel",
  "Isle of Man",
  "India",
  "British Indian Ocean Territory",
  "Iraq",
  "Iran, Islamic Republic of",
  "Iceland",
  "Italy",
  "Jersey",
  "Jamaica",
  "Jordan",
  "Japan",
  "Kenya",
  "Kyrgyzstan",
  "Cambodia",
  "Kiribati",
  "Comoros",
  "Saint Kitts and Nevis",
  "Korea, Democratic People's Republic of",
  "Korea, Republic of",
  "Kuwait",
  "Cayman Islands",
  "Kazakhstan",
  "Lao People's Democratic Republic",
  "Lebanon",
  "Saint Lucia",
  "Liechtenstein",
  "Sri Lanka",
  "Liberia",
  "Lesotho",
  "Lithuania",
  "Luxembourg",
  "Latvia",
  "Libya",
  "Morocco",
  "Monaco",
  "Moldova, Republic of",
  "Montenegro",
  "Saint Martin (French part)",
  "Madagascar",
  "Marshall Islands",
  "Macedonia, the Former Yugoslav Republic of",
  "Mali",
  "Myanmar",
  "Mongolia",
  "Macao",
  "Northern Mariana Islands",
  "Martinique",
  "Mauritania",
  "Montserrat",
  "Malta",
  "Mauritius",
  "Maldives",
  "Malawi",
  "Mexico",
  "Malaysia",
  "Mozambique",
  "Namibia",
  "New Caledonia",
  "Niger",
  "Norfolk Island",
  "Nigeria",
  "Nicaragua",
  "Netherlands",
  "Norway",
  "Nepal",
  "Nauru",
  "Niue",
  "New Zealand",
  "Oman",
  "Panama",
  "Peru",
  "French Polynesia",
  "Papua New Guinea",
  "Philippines",
  "Pakistan",
  "Poland",
  "Saint Pierre and Miquelon",
  "Pitcairn",
  "Puerto Rico",
  "Palestine, State of",
  "Portugal",
  "Palau",
  "Paraguay",
  "Qatar",
  "Reunion",
  "Romania",
  "Serbia",
  "Russian Federation",
  "Rwanda",
  "Saudi Arabia",
  "Solomon Islands",
  "Seychelles",
  "Sudan",
  "Sweden",
  "Singapore",
  "Saint Helena",
  "Slovenia",
  "Svalbard and Jan Mayen",
  "Slovakia",
  "Sierra Leone",
  "San Marino",
  "Senegal",
  "Somalia",
  "Suriname",
  "South Sudan",
  "Sao Tome and Principe",
  "El Salvador",
  "Sint Maarten (Dutch part)",
  "Syrian Arab Republic",
  "Swaziland",
  "Turks and Caicos Islands",
  "Chad",
  "French Southern Territories",
  "Togo",
  "Thailand",
  "Tajikistan",
  "Tokelau",
  "Timor-Leste",
  "Turkmenistan",
  "Tunisia",
  "Tonga",
  "Turkey",
  "Trinidad and Tobago",
  "Tuvalu",
  "Taiwan, Province of China",
  "United Republic of Tanzania",
  "Ukraine",
  "Uganda",
  "United States",
  "Uruguay",
  "Uzbekistan",
  "Holy See (Vatican City State)",
  "Saint Vincent and the Grenadines",
  "Venezuela",
  "British Virgin Islands",
  "US Virgin Islands",
  "Vietnam",
  "Vanuatu",
  "Wallis and Futuna",
  "Samoa",
  "Kosovo",
  "Yemen",
  "Mayotte",
  "South Africa",
  "Zambia",
  "Zimbabwe",
];

export const COUNTRY_ALIASES = {
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "great britain": "United Kingdom",
  "gb": "United Kingdom",
  "usa": "United States",
  "u.s.a.": "United States",
  "us": "United States",
  "u.s.": "United States",
  "united states of america": "United States",
  "uae": "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "the netherlands": "Netherlands",
  "holland": "Netherlands",
  "czechia": "Czech Republic",
  "south korea": "Korea, Republic of",
  "korea": "Korea, Republic of",
  "north korea": "Korea, Democratic People's Republic of",
  "russia": "Russian Federation",
  "vietnam": "Vietnam",
  "viet nam": "Vietnam",
  "taiwan": "Taiwan, Province of China",
  "worldwide": "Worldwide",
  "remote": "Worldwide",
  "global": "Worldwide",
  "work from anywhere": "Worldwide",
  "anywhere": "Worldwide",
};

const COUNTRY_MAP = new Map();
COUNTRIES.forEach((c) => COUNTRY_MAP.set(c.toLowerCase(), c));

// Sorted descending by length to ensure multi-word countries/aliases match first
const ALL_SEARCH_NAMES = [...COUNTRIES, ...Object.keys(COUNTRY_ALIASES)].sort(
  (a, b) => b.length - a.length
);

/**
 * Validates whether a location string includes a recognized Country (or Worldwide/Remote).
 * @param {string} location
 * @returns {{ valid: boolean, country: string | null, reason: string | null }}
 */
export const validateLocationCountry = (location) => {
  if (!location || typeof location !== "string" || !location.trim()) {
    return {
      valid: false,
      country: null,
      reason: "Job location (Country) is required.",
    };
  }

  const cleanLoc = location.trim();
  const lowerLoc = cleanLoc.toLowerCase();

  // 1. Worldwide / Remote check
  if (
    lowerLoc === "worldwide" ||
    lowerLoc === "remote" ||
    lowerLoc === "(remote)" ||
    lowerLoc.includes("worldwide") ||
    lowerLoc.includes("work from anywhere")
  ) {
    return { valid: true, country: "Worldwide", reason: null };
  }

  // 2. Check comma-separated segments (in standard format "City, State, Country", Country is last)
  const parts = cleanLoc
    .split(",")
    .map((s) => s.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""))
    .filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const partLower = parts[i].toLowerCase();
    if (COUNTRY_ALIASES[partLower]) {
      return { valid: true, country: COUNTRY_ALIASES[partLower], reason: null };
    }
    if (COUNTRY_MAP.has(partLower)) {
      return { valid: true, country: COUNTRY_MAP.get(partLower), reason: null };
    }
  }

  // 3. Regex scan with boundary delimiters across entire string
  for (const name of ALL_SEARCH_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reg = new RegExp("(^|[^a-zA-Z0-9])" + escaped + "([^a-zA-Z0-9]|$)", "i");
    if (reg.test(lowerLoc)) {
      const canonical =
        COUNTRY_ALIASES[name.toLowerCase()] ||
        COUNTRY_MAP.get(name.toLowerCase()) ||
        name;
      return { valid: true, country: canonical, reason: null };
    }
  }

  return {
    valid: false,
    country: null,
    reason: 'Location must include a valid Country (e.g. "City, Country" or "Worldwide").',
  };
};

/**
 * Validates a job document before it can be approved / activated into active status.
 * Enforces standard job addition validations:
 * - Company or studio name required
 * - Job title required
 * - At least one Job category required
 * - Location with a valid Country required
 * @param {object} job
 * @returns {{ valid: boolean, errors: string[], missing: object }}
 */
export const validateJobForApproval = (job) => {
  const errors = [];
  const missing = {
    companyName: false,
    jobTitle: false,
    category: false,
    location: false,
  };

  if (!job) {
    return {
      valid: false,
      errors: ["Job data is missing."],
      missing: { companyName: true, jobTitle: true, category: true, location: true },
    };
  }

  // 1. Company Name
  const companyName = job.companyName ? String(job.companyName).trim() : "";
  if (!companyName) {
    errors.push("Company or Studio name is required");
    missing.companyName = true;
  }

  // 2. Job Title
  const jobTitle = job.jobTitle ? String(job.jobTitle).trim() : "";
  if (!jobTitle) {
    errors.push("Job title is required");
    missing.jobTitle = true;
  }

  // 3. Job Category (primary jobCategory or non-empty jobCategories array)
  const hasCategory =
    Boolean(job.jobCategory && (job.jobCategory._id || job.jobCategory.name || job.jobCategory)) ||
    (Array.isArray(job.jobCategories) &&
      job.jobCategories.filter(
        (c) => Boolean(c) && (typeof c === "string" ? Boolean(c.trim()) : Boolean(c._id || c.name))
      ).length > 0);

  if (!hasCategory) {
    errors.push("Job category is required");
    missing.category = true;
  }

  // 4. Location & Country
  const locValidation = validateLocationCountry(job.location);
  if (!locValidation.valid) {
    errors.push(locValidation.reason || "Job location (Country) is required");
    missing.location = true;
  }

  return {
    valid: errors.length === 0,
    errors,
    missing,
    country: locValidation.country,
  };
};
