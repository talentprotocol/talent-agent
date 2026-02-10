# JSON Schema Reference

## Piped Input Schema

### New Format (Zod-validated discriminated union)

#### Search Action

```json
{
  "action": "search",
  "id": "optional-request-id",
  "query": "Find React developers in Berlin",
  "session": "optional-session-id"
}
```

| Field     | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `action`  | string | Yes      | Must be `"search"`                   |
| `id`      | string | No       | Request ID, echoed back in response  |
| `query`   | string | Yes      | Natural language search query         |
| `session` | string | No       | Session ID for refinement            |

#### Detail Action

```json
{
  "action": "detail",
  "id": "optional-request-id",
  "session": "abc123",
  "index": 0
}
```

| Field     | Type   | Required | Description                           |
| --------- | ------ | -------- | ------------------------------------- |
| `action`  | string | Yes      | Must be `"detail"`                    |
| `id`      | string | No       | Request ID, echoed back in response   |
| `session` | string | Yes      | Session ID from a previous search     |
| `index`   | number | Yes      | Zero-based profile index              |

### Legacy Format (backward compatible)

```json
{"query": "Find React developers", "session": "optional"}
{"detail": 0, "session": "required"}
```

## Response Envelope Schema

### Success Response

```json
{
  "success": true,
  "data": {
    "type": "search | detail",
    "session": "string",
    "...": "result-specific fields"
  },
  "meta": {
    "durationMs": 3200,
    "tokensUsed": 1847,
    "toolsCalled": ["searchProfiles"]
  },
  "id": "echoed-request-id-if-provided"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "id": "echoed-request-id-if-provided"
}
```

## Search Result Data

```json
{
  "type": "search",
  "session": "abc123",
  "query": "Find React developers in Berlin",
  "profiles": [
    {
      "id": "profile-id",
      "displayName": "Jane Doe",
      "name": "Jane Doe",
      "bio": "Full-stack developer...",
      "mainRole": "Frontend Engineer",
      "location": "Berlin, Germany",
      "tags": ["React", "TypeScript"],
      "githubTopLanguages": ["TypeScript", "JavaScript"],
      "githubTopFrameworks": ["React", "Next.js"],
      "githubExpertiseLevel": "Senior",
      "githubRecentlyActive": true,
      "linkedinCurrentTitle": "Senior Frontend Engineer",
      "linkedinCurrentCompany": "TechCorp",
      "linkedinYearsExperience": 8
    }
  ],
  "totalMatches": 42,
  "summary": "Found 42 React developers in Berlin...",
  "appliedFilters": {"languages": ["React"], "location": "Berlin"}
}
```

## Detail Result Data

```json
{
  "type": "detail",
  "session": "abc123",
  "profile": {
    "id": "profile-id",
    "displayName": "Jane Doe",
    "mainRole": "Frontend Engineer",
    "location": "Berlin, Germany",
    "bio": "...",
    "tags": ["React", "TypeScript"],
    "github": {
      "topLanguages": "TypeScript, JavaScript",
      "topFrameworks": "React, Next.js",
      "expertiseLevel": "Senior",
      "developerArchetype": "Full-stack",
      "totalContributions": 1234,
      "isRecentlyActive": true,
      "activitySummary": {
        "summary": "Active contributor to...",
        "focusAreas": "Frontend, DevOps"
      }
    },
    "linkedin": {
      "currentTitle": "Senior Frontend Engineer",
      "currentCompany": "TechCorp",
      "totalYearsExperience": 8
    },
    "workExperience": [...],
    "education": [...]
  },
  "summary": "Detailed profile for Jane Doe..."
}
```

## Meta Object

| Field         | Type     | Description                              |
| ------------- | -------- | ---------------------------------------- |
| `durationMs`  | number   | Total time for the agent call in ms      |
| `tokensUsed`  | number   | Total tokens consumed by the AI model    |
| `toolsCalled` | string[] | Names of tools invoked during the call   |
