export interface CrmConnector {
  provider: 'ghl';
  upsertContact(input: {
    phone: string;
    name?: string;
    email?: string;
    tags?: string[];
    customFields?: Record<string, string>;
  }): Promise<{ contactId: string; created?: boolean }>;

  appendNote(input: {
    contactId: string;
    body: string;
  }): Promise<{ noteId: string }>;

  addToPipeline?(input: {
    contactId: string;
    pipelineId: string;
    stageId: string;
    monetaryValue?: number;
  }): Promise<{ opportunityId: string }>;
}
