const axios = require('axios');
require('dotenv').config();

// API configuration constants
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://assessment.ksensetech.com/api';
const HEADERS = { 'x-api-key': API_KEY };

// Utility function to pause execution for a given time (milliseconds)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const fetchPatientsPage = async (page, limit) => {
  let retries = 0;
  const maxRetries = 10;
  const baseDelay = 1000;

  while (retries < maxRetries) {
    try {
      // Make a GET request to fetch patient page
      const res = await axios.get(
        `${BASE_URL}/patients?page=${page}&limit=${limit}`,
        { headers: HEADERS }
      );

      // Safely extract patient data and pagination info
      const patients = res.data?.data ?? [];
      const pagination = res.data?.pagination ?? null;

      console.log(`Fetched page ${page}, got ${patients.length} patients`);
      console.log(`Pagination info for page ${page}:`, pagination);

      return { patients, pagination };
    } catch (error) {
      const status = error.response?.status;

      // Retry on known intermittent status codes
      if ([429, 500, 502, 503].includes(status)) {
        const delay = baseDelay * 2 ** retries;
        console.warn(
          `Retry ${
            retries + 1
          } for page ${page} after ${delay}ms (status ${status})`
        );
        await sleep(delay);
        retries++;
      } else {
        // Log errors and stop retrying
        console.error(`Unrecoverable error on page ${page}:`, error.message);
        break;
      }
    }
  }

  // Return empty result if all retries fail
  return { patients: [], pagination: null };
};

// Checks if a given value is invalid
const isInvalidNumber = (value) =>
  value === null || value === undefined || value === '' || isNaN(value);

// Calculates a risk score for patients based on blood pressure, body temperature, and age
const calculateRiskScore = (patient) => {
  let score = 0;
  let hasDataQualityIssue = false;

  // Blood Pressure
  const bp = patient?.blood_pressure;
  let bpScore = 0;
  if (typeof bp === 'string' && bp.includes('/')) {
    const [systolicStr, diastolicStr] = bp.split('/');
    const systolic = parseInt(systolicStr.trim());
    const diastolic = parseInt(diastolicStr.trim());

    if (isInvalidNumber(systolic) || isInvalidNumber(diastolic)) {
      hasDataQualityIssue = true;
      bpScore = 0;
    } else {
      if (systolic < 120 && diastolic < 80) {
        bpScore = 0;
      } else if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
        bpScore = 1;
      } else if (
        (systolic >= 130 && systolic <= 139) ||
        (diastolic >= 80 && diastolic <= 89)
      ) {
        bpScore = 2;
      } else if (systolic >= 140 || diastolic >= 90) {
        bpScore = 3;
      }
    }
  } else {
    hasDataQualityIssue = true;
    bpScore = 0;
  }

  // Temperature
  const temp = parseFloat(patient?.temperature);
  let tempScore = 0;
  let isFever = false;

  if (isInvalidNumber(temp)) {
    hasDataQualityIssue = true;
    tempScore = 0;
  } else {
    if (temp <= 99.5) {
      tempScore = 0;
    } else if (temp >= 99.6 && temp <= 100.9) {
      tempScore = 1;
      isFever = true;
    } else if (temp >= 101.0) {
      tempScore = 2;
      isFever = true;
    }
  }

  // Age
  const age = parseInt(patient?.age);
  let ageScore = 0;

  if (isInvalidNumber(age)) {
    hasDataQualityIssue = true;
    ageScore = 0;
  } else {
    if (age < 40) {
      ageScore = 0;
    } else if (age >= 40 && age <= 65) {
      ageScore = 1;
    } else if (age > 65) {
      ageScore = 2;
    }
  }

  score = bpScore + tempScore + ageScore;
  return { score, isFever, hasDataQualityIssue };
};

const fetchAllPatients = async () => {
  let allPatients = [];
  let page = 1;
  const limit = 5;
  let hasNext = true;
  const failedPages = []; // Track pages that failed to load initially
  let expectedTotal = null; // Store total patients count

  const highRiskPatientIds = [];
  const feverPatientIds = [];
  const dataQualityIssueIds = [];

  while (hasNext) {
    await sleep(300); // Small delay before each request to avoid rate limits

    const { patients, pagination } = await fetchPatientsPage(page, limit);

    // Update expected total patients count from API response if available
    if (pagination?.total) expectedTotal = pagination.total;

    // If no patients found on a page, mark for retry later and continue
    if (!patients.length) {
      console.warn(`No patients found on page ${page}, will retry later.`);
      failedPages.push(page);
      page++;
      continue;
    }

    for (const patient of patients) {
      const { score, isFever, hasDataQualityIssue } =
        calculateRiskScore(patient);
      patient.riskScore = score;
      patient.isFever = isFever;
      patient.hasDataQualityIssue = hasDataQualityIssue;

      if (score >= 4) highRiskPatientIds.push(patient.patient_id);
      if (isFever) feverPatientIds.push(patient.patient_id);
      if (hasDataQualityIssue) dataQualityIssueIds.push(patient.patient_id);
    }

    // Append patients from current page to the main array
    allPatients = [...allPatients, ...patients];

    // Determine if more pages exist based on pagination response
    hasNext =
      pagination && typeof pagination.hasNext === 'boolean'
        ? pagination.hasNext
        : false;
    page++;

    await sleep(200); // Short delay after each successful request
  }

  // Retry any pages that previously failed once more before finishing
  for (const failedPage of failedPages) {
    await sleep(500);
    const { patients } = await fetchPatientsPage(failedPage);

    if (patients.length) {
      for (const patient of patients) {
        const { score, isFever, hasDataQualityIssue } =
          calculateRiskScore(patient);
        patient.riskScore = score;
        patient.isFever = isFever;
        patient.hasDataQualityIssue = hasDataQualityIssue;

        if (score >= 4) highRiskPatientIds.push(patient.patient_id);
        if (isFever) feverPatientIds.push(patient.patient_id);
        if (hasDataQualityIssue) dataQualityIssueIds.push(patient.patient_id);
      }

      allPatients = [...allPatients, ...patients];
      console.log(`Recovered page ${failedPage} on second attempt`);
    } else {
      console.warn(`Final failure on page ${failedPage}, skipping`);
    }
  }

  // Log total number of patients fetched, warn if less than expected total
  console.log(`Finished fetching all patients: ${allPatients.length} total`);
  if (expectedTotal && allPatients.length < expectedTotal) {
    console.warn(
      `WARNING: Expected ${expectedTotal} patients but only retrieved ${allPatients.length}`
    );
  }

  submitAssessment({
    highRiskPatientIds: [...new Set(highRiskPatientIds)],
    feverPatientIds: [...new Set(feverPatientIds)],
    dataQualityIssueIds: [...new Set(dataQualityIssueIds)],
  });
};

// Logs the patient ID lists grouped by risk category
const submitAssessment = ({
  highRiskPatientIds,
  feverPatientIds,
  dataQualityIssueIds,
}) => {
  console.log('High Risk Patient IDs:', highRiskPatientIds);
  console.log(`Total High Risk Patients: ${highRiskPatientIds.length}\n`);
  console.log('Fever Patient IDs:', feverPatientIds);
  console.log(`Total Fever Patients: ${feverPatientIds.length}\n`);
  console.log('Data Quality Issue Patient IDs:', dataQualityIssueIds);
  console.log(
    `Total Patients with Data Issues: ${dataQualityIssueIds.length}\n`
  );
};

fetchAllPatients();
