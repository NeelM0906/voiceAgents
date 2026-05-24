import { config } from '../config.js';
import type { TenantCrmConfigRow } from '../db/types.js';
import type { CrmConnector } from './types.js';

const GHL_VERSION = '2021-07-28';

export class GhlConnector implements CrmConnector {
  provider = 'ghl' as const;

  constructor(
    private readonly crmConfig: TenantCrmConfigRow,
    private readonly apiKey: string,
  ) {}

  async upsertContact(input: {
    phone: string;
    name?: string;
    email?: string;
    tags?: string[];
    customFields?: Record<string, string>;
  }): Promise<{ contactId: string; created?: boolean }> {
    const response = await this.request('/contacts/upsert', {
      method: 'POST',
      body: JSON.stringify({
        locationId: this.crmConfig.location_id,
        phone: input.phone,
        name: input.name,
        email: input.email,
        tags: input.tags,
        customFields: input.customFields
          ? Object.entries(input.customFields).map(([key, value]) => ({
              key,
              field_value: value,
            }))
          : undefined,
      }),
    });

    const contactId = readStringPath(response, ['contact', 'id']) ?? readStringPath(response, ['id']);

    if (!contactId) {
      throw new Error('GHL upsert response did not include a contact id');
    }

    return {
      contactId,
      created: Boolean(readBooleanPath(response, ['created'])),
    };
  }

  async appendNote(input: {
    contactId: string;
    body: string;
  }): Promise<{ noteId: string }> {
    const response = await this.request(`/contacts/${encodeURIComponent(input.contactId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        body: input.body,
      }),
    });

    const noteId =
      readStringPath(response, ['note', 'id']) ??
      readStringPath(response, ['id']) ??
      readStringPath(response, ['_id']);

    if (!noteId) {
      throw new Error('GHL note response did not include a note id');
    }

    return {
      noteId,
    };
  }

  async addToPipeline(input: {
    contactId: string;
    pipelineId: string;
    stageId: string;
    monetaryValue?: number;
  }): Promise<{ opportunityId: string }> {
    const response = await this.request('/opportunities/', {
      method: 'POST',
      body: JSON.stringify({
        locationId: this.crmConfig.location_id,
        contactId: input.contactId,
        pipelineId: input.pipelineId,
        pipelineStageId: input.stageId,
        monetaryValue: input.monetaryValue ?? 0,
        name: 'AI receptionist lead',
      }),
    });

    const opportunityId =
      readStringPath(response, ['opportunity', 'id']) ?? readStringPath(response, ['id']);

    if (!opportunityId) {
      throw new Error('GHL opportunity response did not include an opportunity id');
    }

    return {
      opportunityId,
    };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const url = new URL(path, config.GHL_API_BASE_URL).toString();
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        version: GHL_VERSION,
        accept: 'application/json',
        'content-type': 'application/json',
        ...init.headers,
      },
    });

    const text = await response.text();
    const body = text ? safeJson(text) : null;

    if (!response.ok) {
      throw new Error(`GHL request failed with HTTP ${response.status}: ${diagnosticText(body)}`);
    }

    return body;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function diagnosticText(body: unknown): string {
  if (typeof body === 'string') {
    return body.slice(0, 500);
  }

  if (body && typeof body === 'object') {
    const message = readStringPath(body, ['message']) ?? readStringPath(body, ['error']);
    return message ?? 'request failed';
  }

  return 'request failed';
}

function readStringPath(value: unknown, path: string[]): string | null {
  let current = value;

  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' && current.trim() ? current : null;
}

function readBooleanPath(value: unknown, path: string[]): boolean | null {
  let current = value;

  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'boolean' ? current : null;
}
