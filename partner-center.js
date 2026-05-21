#!/usr/bin/env node

const TENANT_ID = 'a550751c-f9e0-4365-af65-6a932cf492e2';
const CLIENT_ID = '96071a39-26d3-464b-8d7c-dd62dbad1245';
const API_BASE_URL = 'https://manage.devcenter.microsoft.com';
const APP_NAME_TO_FIND = 'SnapAway';
const CLIENT_SECRET = process.env.PARTNER_CENTER_CLIENT_SECRET || '';

const RESOURCE_CANDIDATES = Array.from(new Set([
  process.env.PARTNER_CENTER_RESOURCE,
  'fa3d9a0c-3fb0-42cc-9193-47c7ecd2edbd',
  'https://manage.devcenter.microsoft.com'
].filter(Boolean)));

const DEVICE_CODE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/devicecode`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/token`;

if (typeof fetch !== 'function') {
  console.error('[Fatal] This script requires Node.js with native fetch support (Node 18+).');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postForm(url, formData) {
  const body = new URLSearchParams(formData);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = await parseJsonSafe(response);
  return { response, data };
}

function extractApplicationsArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.value)) {
    return payload.value;
  }

  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }

  if (payload && Array.isArray(payload.applications)) {
    return payload.applications;
  }

  return [];
}

function collectFieldPaths(value, prefix = 'response', output = new Set()) {
  if (Array.isArray(value)) {
    output.add(prefix);
    if (value.length === 0) {
      output.add(`${prefix}[]`);
    } else {
      collectFieldPaths(value[0], `${prefix}[0]`, output);
    }
    return output;
  }

  if (value && typeof value === 'object') {
    output.add(prefix);
    for (const key of Object.keys(value)) {
      const nextPrefix = `${prefix}.${key}`;
      output.add(nextPrefix);
      collectFieldPaths(value[key], nextPrefix, output);
    }
    return output;
  }

  output.add(prefix);
  return output;
}

function explainAadError(message) {
  const text = String(message || '');

  if (text.includes('AADSTS50020')) {
    return [
      'The signed-in account is not in the tenant that owns this app registration.',
      `Use a work or school account from tenant ${TENANT_ID}, or invite the personal account as a guest in that tenant before retrying.`,
      'If the browser already signed in with a personal Microsoft account, sign out there and authenticate again with the tenant-backed account.'
    ].join(' ');
  }

  if (text.includes('AADSTS650057')) {
    return [
      'The requested resource is not listed in the current app registration permissions.',
      `This script now tries the tenant-approved resource automatically: ${RESOURCE_CANDIDATES[0]}.`,
      'If the error still appears, re-add the Microsoft Store submission API delegated permission in Entra ID and grant admin consent again.'
    ].join(' ');
  }

  if (text.includes('AADSTS7000218')) {
    return [
      'The app registration is being treated as a confidential client during token exchange.',
      'For delegated device-code auth, enable public client flows in the Entra app Authentication settings.',
      'Alternatively, set the PARTNER_CENTER_CLIENT_SECRET environment variable so the token request can include a client secret.'
    ].join(' ');
  }

  return text;
}

async function getDeviceCode() {
  console.log('\n=== Step 1: Requesting device code ===');

  let lastFailure = null;

  for (const resource of RESOURCE_CANDIDATES) {
    console.log('Trying resource:', resource);

    const { response, data } = await postForm(DEVICE_CODE_URL, {
      client_id: CLIENT_ID,
      resource
    });

    if (response.ok) {
      console.log('user_code:', data.user_code || '(not returned)');
      console.log('verification_uri:', data.verification_uri || data.verification_url || '(not returned)');
      if (data.message) {
        console.log('message:', data.message);
      }

      console.log('device_code received:', Boolean(data.device_code));
      console.log('polling interval (seconds):', data.interval || 5);
      console.log('resource accepted by tenant:', resource);

      return {
        ...data,
        resource
      };
    }

    lastFailure = { response, data, resource };
    console.error('[Device Code Error] HTTP', response.status, response.statusText, 'for resource', resource);
    console.error(JSON.stringify(data, null, 2));
  }

  const details = lastFailure && lastFailure.data
    ? (lastFailure.data.error_description || JSON.stringify(lastFailure.data))
    : 'Unknown device-code error.';

  throw new Error(`Failed to request device code. ${explainAadError(details)}`);
}

async function pollForToken(deviceCodeResult) {
  console.log('\n=== Step 2: Waiting for user authentication ===');
  console.log('Complete the sign-in in your browser, then this script will continue automatically.');

  let intervalSeconds = Number(deviceCodeResult.interval) || 5;
  const expiresInSeconds = Number(deviceCodeResult.expires_in) || 900;
  const startedAt = Date.now();

  while (true) {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsedSeconds >= expiresInSeconds) {
      throw new Error('Device code expired before authentication completed.');
    }

    console.log(`Polling token endpoint... (${elapsedSeconds}s elapsed, next wait ${intervalSeconds}s)`);

    const tokenPayload = {
      grant_type: 'device_code',
      client_id: CLIENT_ID,
      code: deviceCodeResult.device_code
    };

    if (CLIENT_SECRET) {
      tokenPayload.client_secret = CLIENT_SECRET;
    }

    const { response, data } = await postForm(TOKEN_URL, tokenPayload);

    if (response.ok && data.access_token) {
      console.log('\n=== Step 3: Access token acquired ===');
      console.log('token_type:', data.token_type || 'Bearer');
      console.log('expires_in:', data.expires_in || '(not returned)');
      return data.access_token;
    }

    const errorCode = data.error;
    const errorDescription = data.error_description || 'No error description returned.';

    if (errorCode === 'authorization_pending') {
      console.log('Authorization still pending. Waiting before next poll...');
      await sleep(intervalSeconds * 1000);
      continue;
    }

    if (errorCode === 'slow_down') {
      intervalSeconds += 5;
      console.log(`Received slow_down. Increasing poll interval to ${intervalSeconds}s.`);
      await sleep(intervalSeconds * 1000);
      continue;
    }

    if (errorCode === 'expired_token') {
      throw new Error(`Device code expired: ${errorDescription}`);
    }

    if (errorCode === 'authorization_declined') {
      throw new Error(`User declined authorization: ${errorDescription}`);
    }

    const expandedMessage = explainAadError(errorDescription);
    throw new Error(`Token request failed: ${errorCode || response.status} - ${expandedMessage}`);
  }
}

async function getClientCredentialsToken(resource) {
  console.log('\n=== Step 3: Falling back to app-only token flow ===');
  console.log('Requesting Partner Center access token using the configured client secret.');

  if (!CLIENT_SECRET) {
    throw new Error('PARTNER_CENTER_CLIENT_SECRET is required for the app-only fallback flow.');
  }

  const { response, data } = await postForm(TOKEN_URL, {
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    resource
  });

  if (!response.ok || !data.access_token) {
    const details = data.error_description || JSON.stringify(data, null, 2);
    throw new Error(`Client credentials token request failed: ${details}`);
  }

  console.log('App-only access token acquired.');
  console.log('expires_in:', data.expires_in || '(not returned)');
  return data.access_token;
}

async function getApplications(accessToken) {
  console.log('\n=== Step 4: Fetching Partner Center applications ===');

  const url = `${API_BASE_URL}/v1.0/my/applications`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const data = await parseJsonSafe(response);

  console.log('\nFull JSON response from Partner Center:');
  console.log(JSON.stringify(data, null, 2));

  console.log('\nAll available field paths for debugging:');
  const fieldPaths = Array.from(collectFieldPaths(data)).sort();
  for (const path of fieldPaths) {
    console.log('-', path);
  }

  if (!response.ok) {
    const apiMessage = String(data && data.message ? data.message : '');
    if (apiMessage.includes('A valid account could not be found with given authorization token')) {
      throw new Error('Partner Center could not map this token to a valid account. Add the Azure AD application to the Partner Center account and assign it the Manager role, or use a delegated token from a Partner Center user after enabling public client flows.');
    }

    throw new Error(`Failed to retrieve applications: HTTP ${response.status} ${response.statusText}`);
  }

  return data;
}

function findApplicationByName(applicationsResponse, appName) {
  console.log(`\n=== Step 5: Looking for application named "${appName}" ===`);

  const applications = extractApplicationsArray(applicationsResponse);
  console.log('Applications discovered:', applications.length);

  const match = applications.find((app) => {
    const candidateNames = [
      app.name,
      app.primaryName,
      app.displayName,
      app.friendlyName,
      app.applicationName
    ].filter(Boolean);

    return candidateNames.some((name) => String(name).toLowerCase() === appName.toLowerCase());
  });

  if (!match) {
    console.log(`No exact application named "${appName}" was found.`);
    return null;
  }

  const applicationId = match.applicationId || match.id || match.appId || null;
  console.log('Matched application object:');
  console.log(JSON.stringify(match, null, 2));
  console.log('Resolved applicationId:', applicationId || '(not found on object)');

  return {
    application: match,
    applicationId
  };
}

async function createFlight(applicationId, accessToken) {
  const url = `${API_BASE_URL}/v1.0/my/applications/${encodeURIComponent(applicationId)}/flights`;
  const requestBody = {
    friendlyName: 'SnapAway Flight',
    description: 'Prepared locally for future Partner Center operations',
    groupIds: []
  };

  console.log('\n=== Step 6: createFlight prepared (dry run only) ===');
  console.log('This function is ready for future use and will NOT send a request right now.');
  console.log('POST', url);
  console.log('Authorization header present:', Boolean(accessToken));
  console.log('Request body that would be sent:');
  console.log(JSON.stringify(requestBody, null, 2));

  return {
    method: 'POST',
    url,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: requestBody,
    dryRun: true
  };
}

(async function main() {
  try {
    console.log('Partner Center device-code flow starting...');
    console.log('Tenant ID:', TENANT_ID);
    console.log('Client ID:', CLIENT_ID);
    console.log('Delegated resource candidates:', RESOURCE_CANDIDATES.join(', '));
    console.log('Client secret configured:', CLIENT_SECRET ? 'yes' : 'no');
    console.log('Important: authenticate with a tenant member or invited guest account, not an unrelated personal Microsoft account.');

    let accessToken;

    if (CLIENT_SECRET) {
      console.log('\nClient secret detected, using the direct confidential-client flow.');
      accessToken = await getClientCredentialsToken(API_BASE_URL);
    } else {
      const deviceCodeResult = await getDeviceCode();

      try {
        accessToken = await pollForToken(deviceCodeResult);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (CLIENT_SECRET && message.includes('AADSTS7000218')) {
          console.warn('\n[Auth Notice]', message);
          accessToken = await getClientCredentialsToken(API_BASE_URL);
        } else {
          throw error;
        }
      }
    }

    const applicationsResponse = await getApplications(accessToken);
    const found = findApplicationByName(applicationsResponse, APP_NAME_TO_FIND);

    if (found && found.applicationId) {
      console.log(`\nApplication "${APP_NAME_TO_FIND}" found with ID: ${found.applicationId}`);
    } else {
      console.log(`\nApplication "${APP_NAME_TO_FIND}" was not resolved to an ID.`);
    }

    console.log('\ncreateFlight(applicationId, accessToken) is defined and ready for future use.');
    console.log('It is intentionally not executed in this script run.');
  } catch (error) {
    console.error('\n[Script Error]', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
})();
