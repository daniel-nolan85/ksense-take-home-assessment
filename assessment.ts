import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// API configuration constants
const API_KEY = process.env.API_KEY;
const BASE_URL = 'https://assessment.ksensetech.com/api';
const HEADERS: Record<string, string> = { 'x-api-key': API_KEY ?? '' };

// Utility function to pause execution for a given time (milliseconds)
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Flag to indicate whether fetching process is active
let isFetching = false;

// Patient type definition
type Patient = {
  patient_id: string;
  blood_pressure?: string;
  temperature?: string;
  age?: string;
  riskScore?: number;
  isFever?: boolean;
  hasDataQualityIssue?: boolean;
};

// Pagination type
type Pagination = {
  total?: number;
  hasNext?: boolean;
};

const fetchPatientsPage = async (
  page: number,
  limit: number
): Promise<{ patients: Patient[]; pagination: Pagination | null }> => {
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
      const patients: Patient[] = res.data?.data ?? [];
      const pagination: Pagination = res.data?.pagination ?? null;

      return { patients, pagination };
    } catch (error: any) {
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
const isInvalidNumber = (value: any): boolean =>
  value === null || value === undefined || value === '' || isNaN(value);

// Calculates a risk score for patients based on blood pressure, body temperature, and age
const calculateRiskScore = (
  patient: Patient
): {
  score: number;
  isFever: boolean;
  hasDataQualityIssue: boolean;
} => {
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
      if (systolic >= 140 || diastolic >= 90) {
        bpScore = 3;
      } else if (
        (systolic >= 130 && systolic <= 139) ||
        (diastolic >= 80 && diastolic <= 89)
      ) {
        bpScore = 2;
      } else if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
        bpScore = 1;
      } else if (systolic < 120 && diastolic < 80) {
        bpScore = 0;
      } else {
        bpScore = 0;
      }
    }
  } else {
    hasDataQualityIssue = true;
    bpScore = 0;
  }

  // Temperature
  const temp = parseFloat(patient?.temperature ?? '');
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
  const age = parseInt(patient?.age ?? '');
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

const fetchAllPatients = async (): Promise<void> => {
  let allPatients: Patient[] = [];
  let page = 1;
  const limit = 5;
  let hasNext = true;
  const failedPages: number[] = []; // Track pages that failed to load initially
  let expectedTotal: number | null = null; // Store total patients count

  const highRiskPatientIds: string[] = [];
  const feverPatientIds: string[] = [];
  const dataQualityIssueIds: string[] = [];

  isFetching = true;
  console.log('Fetching patients started...');

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
    const { patients } = await fetchPatientsPage(failedPage, limit);

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
    } else {
      console.warn(`Final failure on page ${failedPage}, skipping`);
    }
  }

  // Log total number of patients fetched, warn if less than expected total
  if (expectedTotal && allPatients.length < expectedTotal) {
    console.warn(
      `WARNING: Expected ${expectedTotal} patients but only retrieved ${allPatients.length}`
    );
  }

  isFetching = false;
  console.log('Fetching patients completed.');

  await submitAssessment({
    highRiskPatientIds: [...new Set(highRiskPatientIds)],
    feverPatientIds: [...new Set(feverPatientIds)],
    dataQualityIssueIds: [...new Set(dataQualityIssueIds)],
  });
};

// Submit the patient assessment results to the API
const submitAssessment = async ({
  highRiskPatientIds,
  feverPatientIds,
  dataQualityIssueIds,
}: {
  highRiskPatientIds: string[];
  feverPatientIds: string[];
  dataQualityIssueIds: string[];
}): Promise<void> => {
  const payload = {
    high_risk_patients: highRiskPatientIds,
    fever_patients: feverPatientIds,
    data_quality_issues: dataQualityIssueIds,
  };

  try {
    const response = await axios.post(
      `${BASE_URL}/submit-assessment`,
      payload,
      {
        headers: HEADERS,
      }
    );
    console.log('Assessment submitted successfully:', response.data);
  } catch (error: any) {
    console.error('Failed to submit assessment:', error.message);
  }
};

fetchAllPatients();
