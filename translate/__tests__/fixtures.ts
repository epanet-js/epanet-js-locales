export const liveEN = {
  app: {
    title: "Welcome",
    about: "About the app",
    button: {
      save: "Save",
      cancel: "Cancel",
      greet: "Hello {{name}}",
    },
  },
  menu: {
    file: "File",
    edit: "Edit",
  },
};

export const localEN_previous = {
  app: {
    title: "Welcome",
    about: "About this application", // <- modified in liveEN
    button: {
      save: "Save",
      cancel: "Cancel",
      greet: "Hello {{name}}",
    },
  },
  menu: {
    file: "File",
    edit: "Edit",
    view: "View", // <- deleted in liveEN
  },
};

export const targetFR_existing = {
  app: {
    title: "Bienvenue",
    // about missing -> new
    button: {
      save: "Enregistrer",
      cancel: "Annuler",
      greet: "Bonjour {{name}}",
    },
  },
  menu: {
    file: "Fichier",
    edit: "Éditer",
    view: "Affichage", // <- should be deleted
  },
};

export const targetNL_existing = {
  app: {
    title: "Welkom",
    about: "Over de app",
    button: {
      save: "Opslaan",
      cancel: "Annuleren",
      greet: "Hallo {{name}}",
    },
  },
  menu: {
    file: "Bestand",
    edit: "Bewerken",
  },
};
