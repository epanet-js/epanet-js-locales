// Mandatory domain terminology per language (water distribution / hydraulic
// modelling). Injected into the LLM prompt; overrides generic translations.
export const TERMINOLOGY: Record<string, Record<string, string>> = {
  es: {
    asset: 'elemento (plural: elementos). Never use "activo" for asset',
  },
};
