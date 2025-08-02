const axios = require('axios');
require('dotenv').config();

// API configuration constants
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('API_KEY is not set. Please add it to your .env file.');
  process.exit(1); // stop execution if no key
}
const BASE_URL = 'https://assessment.ksensetech.com/api';
const HEADERS = { 'x-api-key': API_KEY };

// Utility function to pause execution for a given time (milliseconds)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const fetchPatientsPage = async (page = 1, limit = 5) => {
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
        await new Promise((res) => setTimeout(res, delay));
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

const fetchAllPatients = async () => {
  let allPatients = [];
  let page = 1;
  let hasNext = true;
  const failedPages = []; // Track pages that failed to load initially
  let expectedTotal = null; // Store total patients count

  while (hasNext) {
    await sleep(300); // Small delay before each request to avoid rate limits

    const { patients, pagination } = await fetchPatientsPage(page);

    // Update expected total patients count from API response if available
    if (pagination?.total) expectedTotal = pagination.total;

    // If no patients found on a page, mark for retry later and continue
    if (!patients.length) {
      console.warn(`No patients found on page ${page}, will retry later.`);
      failedPages.push(page);
      page++;
      continue;
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
  if (failedPages.length) {
    console.log(`Retrying ${failedPages.length} failed page(s)...`);

    for (const failedPage of failedPages) {
      await sleep(500); // Delay between retries
      const { patients } = await fetchPatientsPage(failedPage);

      if (patients.length) {
        allPatients = [...allPatients, ...patients];
        console.log(`Recovered page ${failedPage} on second attempt`);
      } else {
        console.warn(`Final failure on page ${failedPage}, skipping`);
      }
    }
  }

  // Log total number of patients fetched, warn if less than expected total
  console.log(`Finished fetching all patients: ${allPatients.length} total`);
  if (expectedTotal && allPatients.length < expectedTotal) {
    console.warn(
      `WARNING: Expected ${expectedTotal} patients but only retrieved ${allPatients.length}`
    );
  }

  return allPatients;
};

// Start fetching all patients
fetchAllPatients();
