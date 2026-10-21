// Criterion labels bound to the user-supplied original Windows PRI resources.
export const handheldCriterionLabels = {
  "defaults-work": {
    "optimized": {
      "en": "Game functionality works correctly using the default controller configuration.",
      "el": "Το παιχνίδι λειτουργεί σωστά με την προεπιλεγμένη ρύθμιση παραμέτρων του χειριστηρίου."
    },
    "playable": {
      "en": "Some of the settings on the handheld need to be modified to play the game.",
      "el": "Ορισμένες από τις ρυθμίσεις της συσκευής χειρός πρέπει να τροποποιηθούν για την αναπαραγωγή του παιχνιδιού."
    },
    "unsupported": {
      "en": "Some or all areas of the game are not playable with the handheld controller.",
      "el": "Ορισμένες ή όλες οι περιοχές του παιχνιδιού δεν είναι δυνατό να αναπαραχθούν με το χειριστήριο συσκευής χειρός."
    }
  },
  "iconography": {
    "optimized": {
      "en": "The game consistently shows XBOX or handheld specific controller icons.",
      "el": "Το παιχνίδι δείχνει σταθερά εικονίδια χειριστηρίου ειδικά για XBOX ή συσκευές χειρός."
    },
    "playable": {
      "en": "The game has some inaccurate or non-XBOX controller icons.",
      "el": "Το παιχνίδι έχει μερικά ανακριβή εικονίδια χειριστηρίου ή εικονίδια χειριστηρίου που δεν είναι XBOX."
    },
    "unsupported": {
      "en": "The game displays inaccurate or non-XBOX controller for all the controller icons.",
      "el": "Το παιχνίδι εμφανίζει ανακριβές χειριστήριο ή χειριστήριο που δεν είναι XBOX για όλα τα εικονίδια του χειριστηρίου."
    }
  },
  "text-input": {
    "optimized": {
      "en": "For text input, the game provides an on-screen keyboard or a controller-friendly custom text entry method.",
      "el": "Για εισαγωγή κειμένου, το παιχνίδι παρέχει ένα πληκτρολόγιο οθόνης ή μια προσαρμοσμένη μέθοδο καταχώρησης κειμένου, φιλική προς το χειριστήριο."
    },
    "playable": {
      "en": "Entering text requires manually invoking the on-screen keyboard.",
      "el": "Η εισαγωγή κειμένου απαιτεί χειροκίνητη κλήση του πληκτρολογίου οθόνης."
    },
    "unsupported": {
      "en": "The game does not provide an on-screen keyboard or controller-friendly custom text entry method.",
      "el": "Το παιχνίδι δεν παρέχει πληκτρολόγιο οθόνης ή προσαρμοσμένη μέθοδο καταχώρησης κειμένου, φιλική προς το χειριστήριο."
    }
  },
  "ui-legibility": {
    "optimized": {
      "en": "Key text and UI elements are legible on the device by default.",
      "el": "Το βασικό κείμενο και τα στοιχεία περιβάλλοντος εργασίας χρήστη είναι ευανάγνωστα στη συσκευή από προεπιλογή."
    },
    "playable": {
      "en": "Some text is small and may be difficult to read, or may require game settings changes to adjust text size.",
      "el": "Κάποιο κείμενο είναι μικρό και μπορεί να είναι δυσανάγνωστο ή μπορεί να απαιτεί αλλαγές στις ρυθμίσεις του παιχνιδιού για την προσαρμογή του μεγέθους του κειμένου."
    },
    "unsupported": {
      "en": "Some key in-game text is too small to be legible and the game does not provide settings to adjust this.",
      "el": "Κάποιο βασικό κείμενο εντός του παιχνιδιού είναι πολύ μικρό για να είναι ευανάγνωστο και το παιχνίδι δεν παρέχει ρυθμίσεις για την προσαρμογή αυτού του στοιχείου."
    }
  },
  "supported-display": {
    "optimized": {
      "en": "The game's default configuration supports resolutions supported by the device.",
      "el": "Η προεπιλεγμένη ρύθμιση παραμέτρων του παιχνιδιού υποστηρίζει αναλύσεις που υποστηρίζονται από τη συσκευή."
    },
    "playable": {
      "en": "Game settings may require adjustments to support a resolution natively supported by the device.",
      "el": "Οι ρυθμίσεις παιχνιδιού ενδέχεται να απαιτούν προσαρμογές για την υποστήριξη μιας ανάλυσης που υποστηρίζεται εγγενώς από τη συσκευή."
    },
    "unsupported": {
      "en": "The game can not be configured to support a resolution compatible with this device.",
      "el": "Δεν είναι δυνατή η ρύθμιση παραμέτρων του παιχνιδιού ώστε να υποστηρίζει ανάλυση συμβατή με αυτήν τη συσκευή."
    }
  }
} as const;
