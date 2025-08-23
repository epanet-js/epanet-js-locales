# EPANET-JS Locales

This project automatically translates locale files for the EPANET-JS application using machine translation.

## What it does

The script reads the latest English locale file from the live EPANET-JS application and compares it with locally maintained language files. It identifies:

- **New keys** that need translation
- **Modified keys** where the English text has changed
- **Deleted keys** that should be removed

The script then uses Google's Gemini AI to translate the new/modified keys and saves the updated locale files.

## Supported Languages

Currently translates to:

- **Spanish (ES)** - `es`
- **Portuguese (BR)** - `pt`
- **French (FR)** - `fr`
- **Dutch (NL)** - `nl`
- **Japanese (JA)** - `ja`

## How to run

### Prerequisites

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Set up your Gemini API key in a `.env.local` file:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

### Running the script

```bash
pnpm start
```

### Running the script for just one language

Update only spanish:

```bash
pnpm translate:es
```

### Verbose logging

For debugging API issues, enable verbose logging:

```bash
VERBOSE=true pnpm start
```

This will log all API requests/responses and create detailed log files.

## Automation

The translation process runs automatically every night at 5 AM UTC via GitHub Actions, ensuring locale files stay up-to-date with the latest English content.

## Project Structure

```
locales/
├── en/          # English (source)
├── es/          # Spanish
├── fr/          # French
├── nl/          # Dutch
└── pt/          # Portuguese
└── ja/          # Japanese
```
