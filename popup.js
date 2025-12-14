/* popup.js - Nimbus Hub functionality */

(() => {
  const searchInput = document.getElementById('searchInput');
  const suggestions = document.getElementById('suggestions');
  const favoritesDiv = document.getElementById('favorites');
  const recentDiv = document.getElementById('recent');
  const wordOfDayDiv = document.getElementById('wordOfDay');
  const nimbusTitle = document.getElementById('nimbusTitle');

  let searchTimeout = null;
  let currentSuggestions = [];
  let navigationHistory = []; // Stack for back button
  let currentView = 'hub'; // 'hub' or 'word'
  
  // Notification system
  function showNotification(message, type = 'success') {
    const toast = document.getElementById('notificationToast');
    const messageEl = document.getElementById('notificationMessage');
    
    if (!toast || !messageEl) return;
    
    messageEl.textContent = message;
    toast.className = `notification-toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
  
  function showConfirmDialog(message, onConfirm, onCancel) {
    const confirmed = confirm(message);
    if (confirmed && onConfirm) {
      onConfirm();
    } else if (!confirmed && onCancel) {
      onCancel();
    }
    return confirmed;
  }

  // Set favicon dynamically (Chrome extension popups need this)
  try {
    const link = document.querySelector("link[rel='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = chrome.runtime.getURL('Nimbus Favicon.png');
    if (!document.querySelector("link[rel='icon']")) {
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  } catch (e) {
    console.log('Could not set favicon:', e);
  }

  // Load all data on popup open
  // Load settings and translate UI on initial load
  chrome.storage.local.get(['settings'], (result) => {
    try {
      const settings = result.settings || {};
      const initialLang = settings.dictionaryLanguage || detectBrowserLanguage();
      window.currentUILanguage = initialLang;
      translateUI(initialLang);
    } catch (e) {
      console.error('Nimbus: Error in initial translation:', e);
      // Continue loading even if translation fails
    }
  });
  
  // Check for pending search (e.g., person data from content script)
  chrome.storage.local.get(['pendingSearch'], (result) => {
    if (result.pendingSearch) {
      const pending = result.pendingSearch;
      console.log('Nimbus: Found pending search:', pending.type, pending.term);
      console.log('Nimbus: Pending data image:', pending.data?.image ? 'YES - ' + pending.data.image : 'NO IMAGE');
      console.log('Nimbus: Full pending data:', pending.data);
      
      // Clear pending search
      chrome.storage.local.remove(['pendingSearch']);
      
      // Display the search result
      if (pending.type === 'person') {
        console.log('Nimbus: About to display person result, image:', pending.data?.image);
        displayPersonResult(pending.term, pending.data);
      } else {
        showWordDetails(pending.term);
      }
    } else {
      // Load content normally
      try {
        loadFavorites();
        loadRecent();
        loadWordOfDay();
      } catch (e) {
        console.error('Nimbus: Error loading initial content:', e);
      }
    }
  });

  // Nimbus title click handler - return to hub
  nimbusTitle.addEventListener('click', () => {
    returnToHub();
  });

  // Custom Dropdown Functionality
  function initCustomDropdowns() {
    const dropdowns = document.querySelectorAll('.custom-dropdown');
    
    dropdowns.forEach(dropdown => {
      // Skip if already initialized
      if (dropdown.dataset.initialized === 'true') {
        return;
      }
      
      const selected = dropdown.querySelector('.custom-dropdown-selected');
      const options = dropdown.querySelectorAll('.custom-dropdown-option');
      const hiddenInput = dropdown.querySelector('input[type="hidden"]');
      const textSpan = dropdown.querySelector('.custom-dropdown-text');
      
      if (!selected || !hiddenInput || !textSpan) {
        console.warn('Nimbus: Dropdown missing required elements', dropdown);
        return;
      }
      
      // Get initial value
      const initialValue = hiddenInput.value;
      const initialOption = Array.from(options).find(opt => opt.dataset.value === initialValue);
      if (initialOption && textSpan) {
        textSpan.textContent = initialOption.textContent.trim();
        options.forEach(opt => opt.classList.remove('selected'));
        initialOption.classList.add('selected');
      }
      
      // Toggle dropdown
      selected.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isActive = dropdown.classList.contains('active');
        
        // Close all other dropdowns
        document.querySelectorAll('.custom-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('active');
        });
        
        dropdown.classList.toggle('active', !isActive);
      });
      
      // Select option
      options.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const value = option.dataset.value;
          
          // Update hidden input
          hiddenInput.value = value;
          
          // Update display text
          if (textSpan) {
            textSpan.textContent = option.textContent.trim();
          }
          
          // Update selected state
          options.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          
          // Close dropdown
          dropdown.classList.remove('active');
          
          // Trigger change event
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
      
      // Mark as initialized
      dropdown.dataset.initialized = 'true';
    });
    
    // Close dropdowns when clicking outside (only one listener)
    if (!window._dropdownClickHandler) {
      window._dropdownClickHandler = (e) => {
        if (!e.target.closest('.custom-dropdown')) {
          document.querySelectorAll('.custom-dropdown').forEach(d => {
            d.classList.remove('active');
          });
        }
      };
      document.addEventListener('click', window._dropdownClickHandler);
    }
  }
  
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPage = document.getElementById('settingsPage');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const mainContent = document.getElementById('mainContent');
  const refreshBtn = document.getElementById('refreshBtn');
  
  // Refresh button - reload all hub content
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      console.log('Nimbus: Refresh button clicked');
      // Add rotation animation
      refreshBtn.style.transform = 'rotate(360deg)';
      refreshBtn.style.transition = 'transform 0.5s ease';
      
      // Reload all content
      await Promise.all([
        loadFavorites(),
        loadRecent(),
        loadWordOfDay()
      ]);
      
      // Reset rotation after animation
      setTimeout(() => {
        refreshBtn.style.transform = 'rotate(0deg)';
      }, 500);
      
      // Show notification
      const currentLang = window.currentUILanguage || 'en';
      const t = translations[currentLang] || translations.en;
      showNotification(t.refreshComplete || 'Hub refreshed!', 'success');
    });
  }
  
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      mainContent.style.display = 'none';
      settingsPage.style.display = 'flex';
      loadSettings();
      // Initialize custom dropdowns after a brief delay to ensure DOM is ready
      setTimeout(() => {
        initCustomDropdowns();
      }, 50);
    });
  }
  
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => {
      settingsPage.style.display = 'none';
      mainContent.style.display = 'block';
    });
  }
  
  // Settings tab expand/collapse
  const settingsTabHeaders = document.querySelectorAll('.settings-tab-header');
  settingsTabHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const tabName = header.getAttribute('data-tab');
      const tabContent = document.getElementById(`tab-${tabName}`);
      
      if (tabContent) {
        const isExpanded = tabContent.classList.contains('expanded');
        
        // Close all tabs
        document.querySelectorAll('.settings-tab-content').forEach(content => {
          content.classList.remove('expanded');
        });
        document.querySelectorAll('.settings-tab-header').forEach(h => {
          h.classList.remove('active');
        });
        
        // Toggle clicked tab
        if (!isExpanded) {
          tabContent.classList.add('expanded');
          header.classList.add('active');
        }
        
        // Initialize custom dropdowns after tab expansion
        setTimeout(() => {
          initCustomDropdowns();
        }, 100);
      }
    });
  });
  
  // Load settings
  // Translation system
  const translations = {
    en: {
      settings: 'Settings',
      favorites: 'Favorites',
      recentSearches: 'Recent Searches',
      wordOfDay: 'Word of the Day',
      noFavorites: 'No favorites yet. Click the heart icon in tooltips to add words!',
      noRecentSearches: 'No recent searches yet. Select words on web pages to see them here!',
      subscription: 'Subscription',
      modalPlacement: 'Modal Placement',
      apiSettings: 'API Settings',
      general: 'General',
      contact: 'Contact',
      loadMore: 'Load More',
      showLess: 'Show Less',
      clearAll: 'Clear All',
      allRecentSearches: 'All Recent Searches',
      back: 'Back',
      search: 'Search',
      copy: 'Copy',
      addToFavorites: 'Add to favorites',
      removeFromFavorites: 'Remove from favorites',
      manageSubscription: 'Manage Subscription',
      sendMessage: 'Send Message',
      name: 'Name',
      email: 'Email',
      subject: 'Subject',
      message: 'Message',
      yourMessage: 'Your message...',
      weWillGetBack: "We'll get back to you as soon as possible",
      clearAllData: 'Clear All Data',
      removeAllData: 'Remove all favorites, recent searches, and settings',
      loadingFavorites: 'Loading favorites...',
      loadingRecent: 'Loading recent searches...',
      loadingWordOfDay: 'Loading word of the day...',
      errorLoadingWordOfDay: 'Error loading word of the day.',
      searchPlaceholder: 'Search for a word...',
      searchButton: 'Search',
      settingsButton: 'Settings',
      autoRenewDesc: 'Automatically renew your subscription when it expires',
      modalPlacementDesc: 'Choose where the word explanation modal appears when you select text. Custom allows you to drag the modal to your preferred position.',
      modalDraggableDesc: 'Allow dragging the modal to reposition it (grabber handle will appear)',
      openaiKeyDesc: 'Add your OpenAI API key for enhanced explanations. Leave empty to use free dictionary API.',
      saveApiSettings: 'Save API Settings',
      incognitoDesc: 'By default, searches are not saved in incognito mode',
      removeAllDataDesc: 'Remove all favorites, recent searches, and settings',
      contactNamePlaceholder: 'Your name',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: 'Subject',
      autoRenewLabel: 'Auto-renew subscription',
      statusLabel: 'Status:',
      expiresLabel: 'Expires:',
      modalPositionLabel: 'Modal Position:',
      enableDragLabel: 'Enable drag to reposition',
      openaiKeyLabel: 'OpenAI API Key (Optional):',
      explanationStyleLabel: 'Explanation Style:',
      saveInIncognitoLabel: 'Save searches in incognito mode',
      showPhoneticLabel: 'Show phonetic pronunciation',
      showExamplesLabel: 'Show example sentences',
      examplesLabel: 'Examples',
      synonymsLabel: 'Synonyms',
      copyWord: 'Copy word',
      addToFavorites: 'Add to favorites',
      removeFromFavorites: 'Remove from favorites',
      search: 'Search',
      refresh: 'Refresh',
      refreshComplete: 'Hub refreshed!',
      active: 'Active',
      inactive: 'Inactive',
      notAvailable: 'N/A',
      issueTypeLabel: 'Issue Type:',
      more: 'more',
      // Modal placement options
      modalIntuitive: 'Intuitive (Default)',
      modalTop: 'Top of Selection',
      modalBottom: 'Bottom of Selection',
      modalLeft: 'Left of Selection',
      modalRight: 'Right of Selection',
      modalCenter: 'Center of Screen',
      modalCustom: 'Custom (Drag to Position)',
      // Explanation style options
      stylePlain: 'Plain English',
      styleTechnical: 'Technical',
      styleSimple: 'Simple (ELI12)',
      // Issue type options
      issueGeneral: 'General Inquiry',
      issueModalNotWorking: 'Modal Not Working on Page',
      issueWordNotFound: 'Word Not Found/Incorrect',
      issueSubscription: 'Subscription Issue',
      issueBug: 'Bug Report',
      issueFeature: 'Feature Request',
      issueOther: 'Other',
      // Placeholders
      contactNamePlaceholder: 'Your name',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Your message...',
      recentNews: 'Recent News'
    },
    es: {
      settings: 'Configuración',
      favorites: 'Favoritos',
      recentSearches: 'Búsquedas Recientes',
      wordOfDay: 'Palabra del Día',
      noFavorites: 'Aún no hay favoritos. ¡Haz clic en el icono de corazón en las ventanas para agregar palabras!',
      noRecentSearches: 'Aún no hay búsquedas recientes. ¡Selecciona palabras en páginas web para verlas aquí!',
      subscription: 'Suscripción',
      modalPlacement: 'Posición del Modal',
      apiSettings: 'Configuración de API',
      general: 'General',
      contact: 'Contacto',
      loadMore: 'Cargar Más',
      showLess: 'Mostrar Menos',
      clearAll: 'Limpiar Todo',
      allRecentSearches: 'Todas las Búsquedas Recientes',
      back: 'Atrás',
      search: 'Buscar',
      copy: 'Copiar',
      addToFavorites: 'Agregar a favoritos',
      removeFromFavorites: 'Quitar de favoritos',
      manageSubscription: 'Gestionar Suscripción',
      sendMessage: 'Enviar Mensaje',
      name: 'Nombre',
      email: 'Correo',
      subject: 'Asunto',
      message: 'Mensaje',
      yourMessage: 'Tu mensaje...',
      weWillGetBack: 'Te responderemos lo antes posible',
      clearAllData: 'Limpiar Todos los Datos',
      removeAllData: 'Eliminar todos los favoritos, búsquedas recientes y configuraciones',
      loadingFavorites: 'Cargando favoritos...',
      loadingRecent: 'Cargando búsquedas recientes...',
      loadingWordOfDay: 'Cargando palabra del día...',
      errorLoadingWordOfDay: 'Error al cargar la palabra del día.',
      searchPlaceholder: 'Buscar una palabra...',
      searchButton: 'Buscar',
      settingsButton: 'Configuración',
      autoRenewDesc: 'Renovar automáticamente tu suscripción cuando expire',
      modalPlacementDesc: 'Elige dónde aparece el modal de explicación de palabras cuando seleccionas texto. Personalizado te permite arrastrar el modal a tu posición preferida.',
      modalDraggableDesc: 'Permitir arrastrar el modal para reposicionarlo (aparecerá un control de agarre)',
      openaiKeyDesc: 'Agrega tu clave API de OpenAI para explicaciones mejoradas. Déjalo vacío para usar la API de diccionario gratuita.',
      saveApiSettings: 'Guardar Configuración de API',
      incognitoDesc: 'Por defecto, las búsquedas no se guardan en modo incógnito',
      removeAllDataDesc: 'Eliminar todos los favoritos, búsquedas recientes y configuraciones',
      contactNamePlaceholder: 'Tu nombre',
      contactEmailPlaceholder: 'tu.email@ejemplo.com',
      contactSubjectPlaceholder: 'Asunto',
      autoRenewLabel: 'Renovar suscripción automáticamente',
      statusLabel: 'Estado:',
      expiresLabel: 'Expira:',
      modalPositionLabel: 'Posición del Modal:',
      enableDragLabel: 'Habilitar arrastre para reposicionar',
      openaiKeyLabel: 'Clave API de OpenAI (Opcional):',
      explanationStyleLabel: 'Estilo de Explicación:',
      saveInIncognitoLabel: 'Guardar búsquedas en modo incógnito',
      showPhoneticLabel: 'Mostrar pronunciación fonética',
      showExamplesLabel: 'Mostrar oraciones de ejemplo',
      examplesLabel: 'Ejemplos',
      synonymsLabel: 'Sinónimos',
      copyWord: 'Copiar palabra',
      addToFavorites: 'Agregar a favoritos',
      removeFromFavorites: 'Quitar de favoritos',
      search: 'Buscar',
      issueTypeLabel: 'Tipo de Problema:',
      more: 'más',
      modalIntuitive: 'Intuitivo (Predeterminado)',
      modalTop: 'Arriba de la Selección',
      modalBottom: 'Debajo de la Selección',
      modalLeft: 'Izquierda de la Selección',
      modalRight: 'Derecha de la Selección',
      modalCenter: 'Centro de la Pantalla',
      modalCustom: 'Personalizado (Arrastrar para Posicionar)',
      stylePlain: 'Inglés Simple',
      styleTechnical: 'Técnico',
      styleSimple: 'Simple (ELI12)',
      issueGeneral: 'Consulta General',
      issueModalNotWorking: 'Modal No Funciona en la Página',
      issueWordNotFound: 'Palabra No Encontrada/Incorrecta',
      issueSubscription: 'Problema de Suscripción',
      issueBug: 'Reporte de Error',
      issueFeature: 'Solicitud de Función',
      issueOther: 'Otro',
      contactNamePlaceholder: 'Tu nombre',
      contactEmailPlaceholder: 'tu.email@ejemplo.com',
      contactMessagePlaceholder: 'Tu mensaje...',
      recentNews: 'Noticias Recientes'
    },
    fr: {
      settings: 'Paramètres',
      favorites: 'Favoris',
      recentSearches: 'Recherches Récentes',
      wordOfDay: 'Mot du Jour',
      noFavorites: 'Aucun favori pour le moment. Cliquez sur l\'icône cœur dans les bulles pour ajouter des mots!',
      noRecentSearches: 'Aucune recherche récente pour le moment. Sélectionnez des mots sur les pages web pour les voir ici!',
      subscription: 'Abonnement',
      modalPlacement: 'Position du Modal',
      apiSettings: 'Paramètres API',
      general: 'Général',
      contact: 'Contact',
      loadMore: 'Charger Plus',
      showLess: 'Afficher Moins',
      clearAll: 'Tout Effacer',
      allRecentSearches: 'Toutes les Recherches Récentes',
      back: 'Retour',
      search: 'Rechercher',
      copy: 'Copier',
      addToFavorites: 'Ajouter aux favoris',
      removeFromFavorites: 'Retirer des favoris',
      manageSubscription: 'Gérer l\'Abonnement',
      sendMessage: 'Envoyer le Message',
      name: 'Nom',
      email: 'Email',
      subject: 'Sujet',
      message: 'Message',
      yourMessage: 'Votre message...',
      weWillGetBack: 'Nous vous répondrons dès que possible',
      clearAllData: 'Effacer Toutes les Données',
      removeAllData: 'Supprimer tous les favoris, recherches récentes et paramètres',
      loadingFavorites: 'Chargement des favoris...',
      loadingRecent: 'Chargement des recherches récentes...',
      loadingWordOfDay: 'Chargement du mot du jour...',
      errorLoadingWordOfDay: 'Erreur lors du chargement du mot du jour.',
      searchPlaceholder: 'Rechercher un mot...',
      searchButton: 'Rechercher',
      settingsButton: 'Paramètres',
      autoRenewDesc: 'Renouveler automatiquement votre abonnement à l\'expiration',
      modalPlacementDesc: 'Choisissez où apparaît le modal d\'explication de mot lorsque vous sélectionnez du texte. Personnalisé vous permet de faire glisser le modal à votre position préférée.',
      modalDraggableDesc: 'Permettre de faire glisser le modal pour le repositionner (une poignée de préhension apparaîtra)',
      openaiKeyDesc: 'Ajoutez votre clé API OpenAI pour des explications améliorées. Laissez vide pour utiliser l\'API de dictionnaire gratuite.',
      saveApiSettings: 'Enregistrer les Paramètres API',
      incognitoDesc: 'Par défaut, les recherches ne sont pas enregistrées en mode navigation privée',
      removeAllDataDesc: 'Supprimer tous les favoris, recherches récentes et paramètres',
      contactNamePlaceholder: 'Votre nom',
      contactEmailPlaceholder: 'votre.email@exemple.com',
      contactSubjectPlaceholder: 'Sujet',
      autoRenewLabel: 'Renouveler automatiquement l\'abonnement',
      statusLabel: 'Statut:',
      expiresLabel: 'Expire:',
      modalPositionLabel: 'Position du Modal:',
      enableDragLabel: 'Activer le glisser pour repositionner',
      openaiKeyLabel: 'Clé API OpenAI (Optionnelle):',
      explanationStyleLabel: 'Style d\'Explication:',
      saveInIncognitoLabel: 'Enregistrer les recherches en mode navigation privée',
      showPhoneticLabel: 'Afficher la prononciation phonétique',
      showExamplesLabel: 'Afficher les phrases d\'exemple',
      examplesLabel: 'Exemples',
      synonymsLabel: 'Synonymes',
      copyWord: 'Copier le mot',
      addToFavorites: 'Ajouter aux favoris',
      removeFromFavorites: 'Retirer des favoris',
      search: 'Rechercher',
      refresh: 'Actualiser',
      refreshComplete: 'Hub actualisé !',
      active: 'Actif',
      inactive: 'Inactif',
      notAvailable: 'N/D',
      issueTypeLabel: 'Type de Problème:',
      more: 'plus',
      modalIntuitive: 'Intuitif (Par Défaut)',
      modalTop: 'Au-dessus de la Sélection',
      modalBottom: 'En-dessous de la Sélection',
      modalLeft: 'À Gauche de la Sélection',
      modalRight: 'À Droite de la Sélection',
      modalCenter: 'Centre de l\'Écran',
      modalCustom: 'Personnalisé (Glisser pour Positionner)',
      stylePlain: 'Anglais Simple',
      styleTechnical: 'Technique',
      styleSimple: 'Simple (ELI12)',
      issueGeneral: 'Demande Générale',
      issueModalNotWorking: 'Modal Ne Fonctionne Pas sur la Page',
      issueWordNotFound: 'Mot Non Trouvé/Incorrect',
      issueSubscription: 'Problème d\'Abonnement',
      issueBug: 'Rapport de Bug',
      issueFeature: 'Demande de Fonctionnalité',
      issueOther: 'Autre',
      contactNamePlaceholder: 'Votre nom',
      contactEmailPlaceholder: 'votre.email@exemple.com',
      contactMessagePlaceholder: 'Votre message...',
      recentNews: 'Actualités Récentes'
    },
    de: {
      settings: 'Einstellungen',
      favorites: 'Favoriten',
      recentSearches: 'Letzte Suchen',
      wordOfDay: 'Wort des Tages',
      noFavorites: 'Noch keine Favoriten. Klicken Sie auf das Herzsymbol in den Tooltips, um Wörter hinzuzufügen!',
      noRecentSearches: 'Noch keine letzten Suchen. Wählen Sie Wörter auf Webseiten aus, um sie hier zu sehen!',
      subscription: 'Abonnement',
      modalPlacement: 'Modal-Position',
      apiSettings: 'API-Einstellungen',
      general: 'Allgemein',
      contact: 'Kontakt',
      loadMore: 'Mehr Laden',
      showLess: 'Weniger Anzeigen',
      clearAll: 'Alles Löschen',
      allRecentSearches: 'Alle Letzten Suchen',
      back: 'Zurück',
      search: 'Suchen',
      copy: 'Kopieren',
      addToFavorites: 'Zu Favoriten hinzufügen',
      removeFromFavorites: 'Aus Favoriten entfernen',
      manageSubscription: 'Abonnement Verwalten',
      sendMessage: 'Nachricht Senden',
      name: 'Name',
      email: 'E-Mail',
      subject: 'Betreff',
      message: 'Nachricht',
      yourMessage: 'Ihre Nachricht...',
      weWillGetBack: 'Wir werden uns so schnell wie möglich bei Ihnen melden',
      clearAllData: 'Alle Daten Löschen',
      removeAllData: 'Alle Favoriten, letzten Suchen und Einstellungen entfernen',
      loadingFavorites: 'Favoriten werden geladen...',
      loadingRecent: 'Letzte Suchen werden geladen...',
      loadingWordOfDay: 'Wort des Tages wird geladen...',
      errorLoadingWordOfDay: 'Fehler beim Laden des Wortes des Tages.',
      searchPlaceholder: 'Nach einem Wort suchen...',
      searchButton: 'Suchen',
      settingsButton: 'Einstellungen',
      autoRenewDesc: 'Ihr Abonnement automatisch erneuern, wenn es abläuft',
      modalPlacementDesc: 'Wählen Sie, wo das Wort-Erklärungs-Modal erscheint, wenn Sie Text auswählen. Benutzerdefiniert ermöglicht es Ihnen, das Modal an Ihre bevorzugte Position zu ziehen.',
      modalDraggableDesc: 'Zulassen, dass das Modal zum Neupositionieren gezogen wird (ein Greifgriff erscheint)',
      openaiKeyDesc: 'Fügen Sie Ihren OpenAI API-Schlüssel für verbesserte Erklärungen hinzu. Leer lassen, um die kostenlose Wörterbuch-API zu verwenden.',
      saveApiSettings: 'API-Einstellungen Speichern',
      incognitoDesc: 'Standardmäßig werden Suchen im Inkognito-Modus nicht gespeichert',
      removeAllDataDesc: 'Alle Favoriten, letzten Suchen und Einstellungen entfernen',
      contactNamePlaceholder: 'Ihr Name',
      contactEmailPlaceholder: 'ihre.email@beispiel.com',
      contactSubjectPlaceholder: 'Betreff',
      autoRenewLabel: 'Abonnement automatisch erneuern',
      statusLabel: 'Status:',
      expiresLabel: 'Läuft ab:',
      modalPositionLabel: 'Modal-Position:',
      enableDragLabel: 'Ziehen zum Neupositionieren aktivieren',
      openaiKeyLabel: 'OpenAI API-Schlüssel (Optional):',
      explanationStyleLabel: 'Erklärungsstil:',
      saveInIncognitoLabel: 'Suchen im Inkognito-Modus speichern',
      showPhoneticLabel: 'Phonetische Aussprache anzeigen',
      showExamplesLabel: 'Beispielsätze anzeigen',
      examplesLabel: 'Beispiele',
      synonymsLabel: 'Synonyme',
      copyWord: 'Wort kopieren',
      addToFavorites: 'Zu Favoriten hinzufügen',
      removeFromFavorites: 'Aus Favoriten entfernen',
      search: 'Suchen',
      refresh: 'Aktualisieren',
      refreshComplete: 'Hub aktualisiert!',
      active: 'Aktiv',
      inactive: 'Inaktiv',
      notAvailable: 'N/V',
      issueTypeLabel: 'Problemtyp:',
      more: 'mehr',
      modalIntuitive: 'Intuitiv (Standard)',
      modalTop: 'Oberhalb der Auswahl',
      modalBottom: 'Unterhalb der Auswahl',
      modalLeft: 'Links von der Auswahl',
      modalRight: 'Rechts von der Auswahl',
      modalCenter: 'Bildschirmmitte',
      modalCustom: 'Benutzerdefiniert (Ziehen zum Positionieren)',
      stylePlain: 'Einfaches Englisch',
      styleTechnical: 'Technisch',
      styleSimple: 'Einfach (ELI12)',
      issueGeneral: 'Allgemeine Anfrage',
      issueModalNotWorking: 'Modal Funktioniert Nicht auf der Seite',
      issueWordNotFound: 'Wort Nicht Gefunden/Falsch',
      issueSubscription: 'Abonnement-Problem',
      issueBug: 'Fehlerbericht',
      issueFeature: 'Funktionsanfrage',
      issueOther: 'Andere',
      contactNamePlaceholder: 'Ihr Name',
      contactEmailPlaceholder: 'ihre.email@beispiel.com',
      contactMessagePlaceholder: 'Ihre Nachricht...',
      recentNews: 'Aktuelle Nachrichten'
    },
    it: {
      settings: 'Impostazioni',
      favorites: 'Preferiti',
      recentSearches: 'Ricerche Recenti',
      wordOfDay: 'Parola del Giorno',
      noFavorites: 'Nessun preferito ancora. Clicca sull\'icona del cuore nei tooltip per aggiungere parole!',
      noRecentSearches: 'Nessuna ricerca recente ancora. Seleziona parole sulle pagine web per vederle qui!',
      subscription: 'Abbonamento',
      modalPlacement: 'Posizione del Modale',
      apiSettings: 'Impostazioni API',
      general: 'Generale',
      contact: 'Contatto',
      loadMore: 'Carica Altro',
      showLess: 'Mostra Meno',
      clearAll: 'Cancella Tutto',
      allRecentSearches: 'Tutte le Ricerche Recenti',
      back: 'Indietro',
      search: 'Cerca',
      copy: 'Copia',
      addToFavorites: 'Aggiungi ai preferiti',
      removeFromFavorites: 'Rimuovi dai preferiti',
      manageSubscription: 'Gestisci Abbonamento',
      sendMessage: 'Invia Messaggio',
      name: 'Nome',
      email: 'Email',
      subject: 'Oggetto',
      message: 'Messaggio',
      yourMessage: 'Il tuo messaggio...',
      weWillGetBack: 'Ti risponderemo il prima possibile',
      clearAllData: 'Cancella Tutti i Dati',
      removeAllData: 'Rimuovi tutti i preferiti, ricerche recenti e impostazioni',
      loadingFavorites: 'Caricamento preferiti...',
      loadingRecent: 'Caricamento ricerche recenti...',
      loadingWordOfDay: 'Caricamento parola del giorno...',
      errorLoadingWordOfDay: 'Errore nel caricamento della parola del giorno.',
      searchPlaceholder: 'Cerca una parola...',
      searchButton: 'Cerca',
      settingsButton: 'Impostazioni',
      autoRenewDesc: 'Rinnova automaticamente il tuo abbonamento alla scadenza',
      modalPlacementDesc: 'Scegli dove appare il modale di spiegazione della parola quando selezioni il testo. Personalizzato ti consente di trascinare il modale nella posizione preferita.',
      modalDraggableDesc: 'Consenti di trascinare il modale per riposizionarlo (apparirà una maniglia di trascinamento)',
      openaiKeyDesc: 'Aggiungi la tua chiave API OpenAI per spiegazioni migliorate. Lascia vuoto per usare l\'API del dizionario gratuito.',
      saveApiSettings: 'Salva Impostazioni API',
      incognitoDesc: 'Per impostazione predefinita, le ricerche non vengono salvate in modalità incognito',
      removeAllDataDesc: 'Rimuovi tutti i preferiti, ricerche recenti e impostazioni',
      contactNamePlaceholder: 'Il tuo nome',
      contactEmailPlaceholder: 'tua.email@esempio.com',
      contactSubjectPlaceholder: 'Oggetto',
      autoRenewLabel: 'Rinnova abbonamento automaticamente',
      statusLabel: 'Stato:',
      expiresLabel: 'Scade:',
      modalPositionLabel: 'Posizione del Modale:',
      enableDragLabel: 'Abilita trascinamento per riposizionare',
      openaiKeyLabel: 'Chiave API OpenAI (Opzionale):',
      explanationStyleLabel: 'Stile di Spiegazione:',
      saveInIncognitoLabel: 'Salva ricerche in modalità incognito',
      showPhoneticLabel: 'Mostra pronuncia fonetica',
      showExamplesLabel: 'Mostra frasi di esempio',
      examplesLabel: 'Esempi',
      synonymsLabel: 'Sinonimi',
      copyWord: 'Copia parola',
      addToFavorites: 'Aggiungi ai preferiti',
      removeFromFavorites: 'Rimuovi dai preferiti',
      search: 'Cerca',
      refresh: 'Aggiorna',
      refreshComplete: 'Hub aggiornato!',
      active: 'Attivo',
      inactive: 'Inattivo',
      notAvailable: 'N/D',
      issueTypeLabel: 'Tipo di Problema:',
      more: 'di più',
      modalIntuitive: 'Intuitivo (Predefinito)',
      modalTop: 'Sopra la Selezione',
      modalBottom: 'Sotto la Selezione',
      modalLeft: 'A Sinistra della Selezione',
      modalRight: 'A Destra della Selezione',
      modalCenter: 'Centro dello Schermo',
      modalCustom: 'Personalizzato (Trascina per Posizionare)',
      stylePlain: 'Inglese Semplice',
      styleTechnical: 'Tecnico',
      styleSimple: 'Semplice (ELI12)',
      issueGeneral: 'Richiesta Generale',
      issueModalNotWorking: 'Modal Non Funziona sulla Pagina',
      issueWordNotFound: 'Parola Non Trovata/Incorretta',
      issueSubscription: 'Problema di Abbonamento',
      issueBug: 'Segnalazione Bug',
      issueFeature: 'Richiesta Funzionalità',
      issueOther: 'Altro',
      contactNamePlaceholder: 'Il tuo nome',
      contactEmailPlaceholder: 'tua.email@esempio.com',
      contactMessagePlaceholder: 'Il tuo messaggio...',
      recentNews: 'Notizie Recenti'
    },
    pt: {
      settings: 'Configurações',
      favorites: 'Favoritos',
      recentSearches: 'Pesquisas Recentes',
      wordOfDay: 'Palavra do Dia',
      noFavorites: 'Ainda não há favoritos. Clique no ícone de coração nas dicas para adicionar palavras!',
      noRecentSearches: 'Ainda não há pesquisas recentes. Selecione palavras em páginas da web para vê-las aqui!',
      subscription: 'Assinatura',
      modalPlacement: 'Posição do Modal',
      apiSettings: 'Configurações da API',
      general: 'Geral',
      contact: 'Contato',
      loadMore: 'Carregar Mais',
      showLess: 'Mostrar Menos',
      clearAll: 'Limpar Tudo',
      allRecentSearches: 'Todas as Pesquisas Recentes',
      back: 'Voltar',
      search: 'Pesquisar',
      copy: 'Copiar',
      addToFavorites: 'Adicionar aos favoritos',
      removeFromFavorites: 'Remover dos favoritos',
      manageSubscription: 'Gerenciar Assinatura',
      sendMessage: 'Enviar Mensagem',
      name: 'Nome',
      email: 'Email',
      subject: 'Assunto',
      message: 'Mensagem',
      yourMessage: 'Sua mensagem...',
      weWillGetBack: 'Entraremos em contato o mais rápido possível',
      clearAllData: 'Limpar Todos os Dados',
      removeAllData: 'Remover todos os favoritos, pesquisas recentes e configurações',
      loadingFavorites: 'Carregando favoritos...',
      loadingRecent: 'Carregando pesquisas recentes...',
      loadingWordOfDay: 'Carregando palavra do dia...',
      errorLoadingWordOfDay: 'Erro ao carregar a palavra do dia.',
      searchPlaceholder: 'Pesquisar uma palavra...',
      searchButton: 'Pesquisar',
      settingsButton: 'Configurações',
      autoRenewDesc: 'Renovar automaticamente sua assinatura quando expirar',
      modalPlacementDesc: 'Escolha onde o modal de explicação de palavra aparece quando você seleciona texto. Personalizado permite arrastar o modal para sua posição preferida.',
      modalDraggableDesc: 'Permitir arrastar o modal para reposicioná-lo (um controle de arraste aparecerá)',
      openaiKeyDesc: 'Adicione sua chave API OpenAI para explicações aprimoradas. Deixe vazio para usar a API de dicionário gratuito.',
      saveApiSettings: 'Salvar Configurações da API',
      incognitoDesc: 'Por padrão, as pesquisas não são salvas no modo anônimo',
      removeAllDataDesc: 'Remover todos os favoritos, pesquisas recentes e configurações',
      contactNamePlaceholder: 'Seu nome',
      contactEmailPlaceholder: 'seu.email@exemplo.com',
      contactSubjectPlaceholder: 'Assunto',
      autoRenewLabel: 'Renovar assinatura automaticamente',
      statusLabel: 'Status:',
      expiresLabel: 'Expira:',
      modalPositionLabel: 'Posição do Modal:',
      enableDragLabel: 'Habilitar arrastar para reposicionar',
      openaiKeyLabel: 'Chave API OpenAI (Opcional):',
      explanationStyleLabel: 'Estilo de Explicação:',
      saveInIncognitoLabel: 'Salvar pesquisas no modo anônimo',
      showPhoneticLabel: 'Mostrar pronúncia fonética',
      showExamplesLabel: 'Mostrar frases de exemplo',
      examplesLabel: 'Exemplos',
      synonymsLabel: 'Sinônimos',
      copyWord: 'Copiar palavra',
      addToFavorites: 'Adicionar aos favoritos',
      removeFromFavorites: 'Remover dos favoritos',
      search: 'Pesquisar',
      refresh: 'Atualizar',
      refreshComplete: 'Hub atualizado!',
      active: 'Ativo',
      inactive: 'Inativo',
      notAvailable: 'N/D',
      issueTypeLabel: 'Tipo de Problema:',
      more: 'mais',
      modalIntuitive: 'Intuitivo (Padrão)',
      modalTop: 'Acima da Seleção',
      modalBottom: 'Abaixo da Seleção',
      modalLeft: 'À Esquerda da Seleção',
      modalRight: 'À Direita da Seleção',
      modalCenter: 'Centro da Tela',
      modalCustom: 'Personalizado (Arrastar para Posicionar)',
      stylePlain: 'Inglês Simples',
      styleTechnical: 'Técnico',
      styleSimple: 'Simples (ELI12)',
      issueGeneral: 'Consulta Geral',
      issueModalNotWorking: 'Modal Não Funciona na Página',
      issueWordNotFound: 'Palavra Não Encontrada/Incorreta',
      issueSubscription: 'Problema de Assinatura',
      issueBug: 'Relatório de Bug',
      issueFeature: 'Solicitação de Recurso',
      issueOther: 'Outro',
      contactNamePlaceholder: 'Seu nome',
      contactEmailPlaceholder: 'seu.email@exemplo.com',
      contactMessagePlaceholder: 'Sua mensagem...',
      recentNews: 'Notícias Recentes'
    },
    ru: {
      settings: 'Настройки',
      favorites: 'Избранное',
      recentSearches: 'Недавние Поиски',
      wordOfDay: 'Слово Дня',
      noFavorites: 'Пока нет избранного. Нажмите на иконку сердца во всплывающих подсказках, чтобы добавить слова!',
      noRecentSearches: 'Пока нет недавних поисков. Выберите слова на веб-страницах, чтобы увидеть их здесь!',
      subscription: 'Подписка',
      modalPlacement: 'Позиция Модального Окна',
      apiSettings: 'Настройки API',
      general: 'Общие',
      contact: 'Контакты',
      loadMore: 'Загрузить Больше',
      showLess: 'Показать Меньше',
      clearAll: 'Очистить Все',
      allRecentSearches: 'Все Недавние Поиски',
      back: 'Назад',
      search: 'Поиск',
      copy: 'Копировать',
      addToFavorites: 'Добавить в избранное',
      removeFromFavorites: 'Удалить из избранного',
      manageSubscription: 'Управление Подпиской',
      sendMessage: 'Отправить Сообщение',
      name: 'Имя',
      email: 'Email',
      subject: 'Тема',
      message: 'Сообщение',
      yourMessage: 'Ваше сообщение...',
      weWillGetBack: 'Мы свяжемся с вами как можно скорее',
      clearAllData: 'Очистить Все Данные',
      removeAllData: 'Удалить все избранное, недавние поиски и настройки',
      loadingFavorites: 'Загрузка избранного...',
      loadingRecent: 'Загрузка недавних поисков...',
      loadingWordOfDay: 'Загрузка слова дня...',
      errorLoadingWordOfDay: 'Ошибка загрузки слова дня.',
      searchPlaceholder: 'Поиск слова...',
      searchButton: 'Поиск',
      settingsButton: 'Настройки',
      autoRenewDesc: 'Автоматически продлевать подписку при истечении',
      modalPlacementDesc: 'Выберите, где появляется модальное окно объяснения слова при выборе текста. Пользовательский позволяет перетаскивать модальное окно в предпочтительное положение.',
      modalDraggableDesc: 'Разрешить перетаскивание модального окна для изменения его положения (появится ручка захвата)',
      openaiKeyDesc: 'Добавьте ваш ключ API OpenAI для улучшенных объяснений. Оставьте пустым, чтобы использовать бесплатный API словаря.',
      saveApiSettings: 'Сохранить Настройки API',
      incognitoDesc: 'По умолчанию поиски не сохраняются в режиме инкогнито',
      removeAllDataDesc: 'Удалить все избранное, недавние поиски и настройки',
      contactNamePlaceholder: 'Ваше имя',
      contactEmailPlaceholder: 'ваш.email@пример.com',
      contactSubjectPlaceholder: 'Тема',
      autoRenewLabel: 'Автоматически продлевать подписку',
      statusLabel: 'Статус:',
      expiresLabel: 'Истекает:',
      modalPositionLabel: 'Позиция Модального Окна:',
      enableDragLabel: 'Включить перетаскивание для изменения положения',
      openaiKeyLabel: 'Ключ API OpenAI (Необязательно):',
      explanationStyleLabel: 'Стиль Объяснения:',
      saveInIncognitoLabel: 'Сохранять поиски в режиме инкогнито',
      showPhoneticLabel: 'Показывать фонетическое произношение',
      showExamplesLabel: 'Показывать примеры предложений',
      examplesLabel: 'Примеры',
      synonymsLabel: 'Синонимы',
      copyWord: 'Копировать слово',
      addToFavorites: 'Добавить в избранное',
      removeFromFavorites: 'Удалить из избранного',
      search: 'Поиск',
      refresh: 'Обновить',
      refreshComplete: 'Хаб обновлен!',
      active: 'Активен',
      inactive: 'Неактивен',
      notAvailable: 'Н/Д',
      issueTypeLabel: 'Тип Проблемы:',
      more: 'больше',
      modalIntuitive: 'Интуитивно (По Умолчанию)',
      modalTop: 'Над Выделением',
      modalBottom: 'Под Выделением',
      modalLeft: 'Слева от Выделения',
      modalRight: 'Справа от Выделения',
      modalCenter: 'Центр Экрана',
      modalCustom: 'Пользовательский (Перетащить для Позиционирования)',
      stylePlain: 'Простой Английский',
      styleTechnical: 'Технический',
      styleSimple: 'Простой (ELI12)',
      issueGeneral: 'Общий Запрос',
      issueModalNotWorking: 'Модальное Окно Не Работает на Странице',
      issueWordNotFound: 'Слово Не Найдено/Неверно',
      issueSubscription: 'Проблема с Подпиской',
      issueBug: 'Сообщение об Ошибке',
      issueFeature: 'Запрос Функции',
      issueOther: 'Другое',
      contactNamePlaceholder: 'Ваше имя',
      contactEmailPlaceholder: 'ваш.email@пример.com',
      contactMessagePlaceholder: 'Ваше сообщение...',
      recentNews: 'Последние Новости'
    },
    ja: {
      settings: '設定',
      favorites: 'お気に入り',
      recentSearches: '最近の検索',
      wordOfDay: '今日の単語',
      noFavorites: 'まだお気に入りがありません。ツールチップのハートアイコンをクリックして単語を追加してください！',
      noRecentSearches: 'まだ最近の検索がありません。ウェブページで単語を選択すると、ここに表示されます！',
      subscription: 'サブスクリプション',
      modalPlacement: 'モーダルの位置',
      apiSettings: 'API設定',
      general: '一般',
      contact: 'お問い合わせ',
      loadMore: 'さらに読み込む',
      showLess: '表示を減らす',
      clearAll: 'すべてクリア',
      allRecentSearches: 'すべての最近の検索',
      back: '戻る',
      search: '検索',
      copy: 'コピー',
      addToFavorites: 'お気に入りに追加',
      removeFromFavorites: 'お気に入りから削除',
      manageSubscription: 'サブスクリプション管理',
      sendMessage: 'メッセージを送信',
      name: '名前',
      email: 'メール',
      subject: '件名',
      message: 'メッセージ',
      yourMessage: 'あなたのメッセージ...',
      weWillGetBack: 'できるだけ早くご連絡いたします',
      clearAllData: 'すべてのデータをクリア',
      removeAllData: 'すべてのお気に入り、最近の検索、設定を削除',
      loadingFavorites: 'お気に入りを読み込み中...',
      loadingRecent: '最近の検索を読み込み中...',
      loadingWordOfDay: '今日の単語を読み込み中...',
      errorLoadingWordOfDay: '今日の単語の読み込みエラー。',
      searchPlaceholder: '単語を検索...',
      searchButton: '検索',
      settingsButton: '設定',
      autoRenewDesc: '期限切れ時にサブスクリプションを自動的に更新',
      modalPlacementDesc: 'テキストを選択したときに単語説明モーダルが表示される場所を選択します。カスタムでは、モーダルを希望の位置にドラッグできます。',
      modalDraggableDesc: 'モーダルをドラッグして再配置できるようにする（グリッパーハンドルが表示されます）',
      openaiKeyDesc: '強化された説明のためにOpenAI APIキーを追加してください。空のままにすると、無料の辞書APIが使用されます。',
      saveApiSettings: 'API設定を保存',
      incognitoDesc: 'デフォルトでは、シークレットモードでは検索が保存されません',
      removeAllDataDesc: 'すべてのお気に入り、最近の検索、設定を削除',
      contactNamePlaceholder: 'お名前',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: '件名',
      autoRenewLabel: 'サブスクリプションを自動更新',
      statusLabel: 'ステータス:',
      expiresLabel: '有効期限:',
      modalPositionLabel: 'モーダルの位置:',
      enableDragLabel: 'ドラッグで再配置を有効にする',
      openaiKeyLabel: 'OpenAI APIキー（オプション）:',
      explanationStyleLabel: '説明スタイル:',
      saveInIncognitoLabel: 'シークレットモードで検索を保存',
      showPhoneticLabel: '音声発音を表示',
      showExamplesLabel: '例文を表示',
      examplesLabel: '例',
      synonymsLabel: '同義語',
      copyWord: '単語をコピー',
      addToFavorites: 'お気に入りに追加',
      removeFromFavorites: 'お気に入りから削除',
      search: '検索',
      refresh: '更新',
      refreshComplete: 'ハブを更新しました！',
      active: 'アクティブ',
      inactive: '非アクティブ',
      notAvailable: 'N/A',
      issueTypeLabel: '問題の種類:',
      more: 'もっと',
      modalIntuitive: '直感的（デフォルト）',
      modalTop: '選択の上',
      modalBottom: '選択の下',
      modalLeft: '選択の左',
      modalRight: '選択の右',
      modalCenter: '画面中央',
      modalCustom: 'カスタム（ドラッグして配置）',
      stylePlain: 'シンプルな英語',
      styleTechnical: '技術的',
      styleSimple: 'シンプル（ELI12）',
      issueGeneral: '一般的な問い合わせ',
      issueModalNotWorking: 'ページでモーダルが動作しない',
      issueWordNotFound: '単語が見つからない/不正',
      issueSubscription: 'サブスクリプションの問題',
      issueBug: 'バグレポート',
      issueFeature: '機能リクエスト',
      issueOther: 'その他',
      contactNamePlaceholder: 'お名前',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'メッセージ...',
      recentNews: '最近のニュース'
    },
    zh: {
      settings: '设置',
      favorites: '收藏',
      recentSearches: '最近搜索',
      wordOfDay: '每日一词',
      noFavorites: '还没有收藏。点击提示中的心形图标来添加单词！',
      noRecentSearches: '还没有最近搜索。在网页上选择单词以在此处查看！',
      subscription: '订阅',
      modalPlacement: '模态框位置',
      apiSettings: 'API设置',
      general: '常规',
      contact: '联系',
      loadMore: '加载更多',
      showLess: '显示更少',
      clearAll: '清除全部',
      allRecentSearches: '所有最近搜索',
      back: '返回',
      search: '搜索',
      copy: '复制',
      addToFavorites: '添加到收藏',
      removeFromFavorites: '从收藏中移除',
      manageSubscription: '管理订阅',
      sendMessage: '发送消息',
      name: '姓名',
      email: '邮箱',
      subject: '主题',
      message: '消息',
      yourMessage: '您的消息...',
      weWillGetBack: '我们会尽快回复您',
      clearAllData: '清除所有数据',
      removeAllData: '删除所有收藏、最近搜索和设置',
      loadingFavorites: '正在加载收藏...',
      loadingRecent: '正在加载最近搜索...',
      loadingWordOfDay: '正在加载每日一词...',
      errorLoadingWordOfDay: '加载每日一词时出错。',
      searchPlaceholder: '搜索单词...',
      searchButton: '搜索',
      settingsButton: '设置',
      autoRenewDesc: '到期时自动续订您的订阅',
      modalPlacementDesc: '选择选择文本时单词解释模态框出现的位置。自定义允许您将模态框拖到首选位置。',
      modalDraggableDesc: '允许拖动模态框以重新定位（将出现抓取手柄）',
      openaiKeyDesc: '添加您的OpenAI API密钥以获得增强的解释。留空以使用免费字典API。',
      saveApiSettings: '保存API设置',
      incognitoDesc: '默认情况下，在隐身模式下不保存搜索',
      removeAllDataDesc: '删除所有收藏、最近搜索和设置',
      contactNamePlaceholder: '您的姓名',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: '主题',
      autoRenewLabel: '自动续订订阅',
      statusLabel: '状态:',
      expiresLabel: '到期:',
      modalPositionLabel: '模态框位置:',
      enableDragLabel: '启用拖动重新定位',
      openaiKeyLabel: 'OpenAI API密钥（可选）:',
      explanationStyleLabel: '解释风格:',
      saveInIncognitoLabel: '在隐身模式下保存搜索',
      showPhoneticLabel: '显示音标发音',
      showExamplesLabel: '显示例句',
      examplesLabel: '例子',
      synonymsLabel: '同义词',
      copyWord: '复制单词',
      addToFavorites: '添加到收藏',
      removeFromFavorites: '从收藏中移除',
      search: '搜索',
      refresh: '刷新',
      refreshComplete: '中心已刷新！',
      active: '活跃',
      inactive: '非活跃',
      notAvailable: '不适用',
      issueTypeLabel: '问题类型:',
      more: '更多',
      modalIntuitive: '直观（默认）',
      modalTop: '选择上方',
      modalBottom: '选择下方',
      modalLeft: '选择左侧',
      modalRight: '选择右侧',
      modalCenter: '屏幕中央',
      modalCustom: '自定义（拖拽定位）',
      stylePlain: '简单英语',
      styleTechnical: '技术性',
      styleSimple: '简单（ELI12）',
      issueGeneral: '一般咨询',
      issueModalNotWorking: '模态框在页面上不工作',
      issueWordNotFound: '未找到单词/不正确',
      issueSubscription: '订阅问题',
      issueBug: '错误报告',
      issueFeature: '功能请求',
      issueOther: '其他',
      contactNamePlaceholder: '您的姓名',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: '您的消息...',
      recentNews: '最近新闻'
    },
    ko: {
      settings: '설정',
      favorites: '즐겨찾기',
      recentSearches: '최근 검색',
      wordOfDay: '오늘의 단어',
      noFavorites: '아직 즐겨찾기가 없습니다. 툴팁의 하트 아이콘을 클릭하여 단어를 추가하세요!',
      noRecentSearches: '아직 최근 검색이 없습니다. 웹 페이지에서 단어를 선택하면 여기에 표시됩니다!',
      subscription: '구독',
      modalPlacement: '모달 위치',
      apiSettings: 'API 설정',
      general: '일반',
      contact: '연락처',
      loadMore: '더 로드',
      showLess: '덜 표시',
      clearAll: '모두 지우기',
      allRecentSearches: '모든 최근 검색',
      back: '뒤로',
      search: '검색',
      copy: '복사',
      addToFavorites: '즐겨찾기에 추가',
      removeFromFavorites: '즐겨찾기에서 제거',
      manageSubscription: '구독 관리',
      sendMessage: '메시지 보내기',
      name: '이름',
      email: '이메일',
      subject: '제목',
      message: '메시지',
      yourMessage: '메시지를 입력하세요...',
      weWillGetBack: '가능한 한 빨리 연락드리겠습니다',
      clearAllData: '모든 데이터 지우기',
      removeAllData: '모든 즐겨찾기, 최근 검색 및 설정 제거',
      loadingFavorites: '즐겨찾기 로드 중...',
      loadingRecent: '최근 검색 로드 중...',
      loadingWordOfDay: '오늘의 단어 로드 중...',
      errorLoadingWordOfDay: '오늘의 단어 로드 오류.',
      searchPlaceholder: '단어 검색...',
      searchButton: '검색',
      settingsButton: '설정',
      autoRenewDesc: '만료 시 구독을 자동으로 갱신',
      modalPlacementDesc: '텍스트를 선택할 때 단어 설명 모달이 나타나는 위치를 선택합니다. 사용자 정의를 사용하면 모달을 원하는 위치로 드래그할 수 있습니다.',
      modalDraggableDesc: '모달을 드래그하여 재배치할 수 있도록 허용 (잡기 핸들이 나타남)',
      openaiKeyDesc: '향상된 설명을 위해 OpenAI API 키를 추가하세요. 비워두면 무료 사전 API를 사용합니다.',
      saveApiSettings: 'API 설정 저장',
      incognitoDesc: '기본적으로 시크릿 모드에서는 검색이 저장되지 않습니다',
      removeAllDataDesc: '모든 즐겨찾기, 최근 검색 및 설정 제거',
      contactNamePlaceholder: '이름',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: '제목',
      autoRenewLabel: '구독 자동 갱신',
      statusLabel: '상태:',
      expiresLabel: '만료:',
      modalPositionLabel: '모달 위치:',
      enableDragLabel: '드래그로 재배치 활성화',
      openaiKeyLabel: 'OpenAI API 키 (선택사항):',
      explanationStyleLabel: '설명 스타일:',
      saveInIncognitoLabel: '시크릿 모드에서 검색 저장',
      showPhoneticLabel: '음성 발음 표시',
      showExamplesLabel: '예문 표시',
      examplesLabel: '예',
      synonymsLabel: '동의어',
      copyWord: '단어 복사',
      addToFavorites: '즐겨찾기에 추가',
      removeFromFavorites: '즐겨찾기에서 제거',
      search: '검색',
      refresh: '새로고침',
      refreshComplete: '허브가 새로고침되었습니다!',
      active: '활성',
      inactive: '비활성',
      notAvailable: '해당 없음',
      issueTypeLabel: '문제 유형:',
      more: '더',
      modalIntuitive: '직관적 (기본값)',
      modalTop: '선택 위',
      modalBottom: '선택 아래',
      modalLeft: '선택 왼쪽',
      modalRight: '선택 오른쪽',
      modalCenter: '화면 중앙',
      modalCustom: '사용자 정의 (드래그하여 위치 지정)',
      stylePlain: '간단한 영어',
      styleTechnical: '기술적',
      styleSimple: '간단함 (ELI12)',
      issueGeneral: '일반 문의',
      issueModalNotWorking: '페이지에서 모달이 작동하지 않음',
      issueWordNotFound: '단어를 찾을 수 없음/잘못됨',
      issueSubscription: '구독 문제',
      issueBug: '버그 보고',
      issueFeature: '기능 요청',
      issueOther: '기타',
      contactNamePlaceholder: '이름',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: '메시지...',
      recentNews: '최근 뉴스'
    },
    ar: {
      settings: 'الإعدادات',
      favorites: 'المفضلة',
      recentSearches: 'البحث الأخير',
      wordOfDay: 'كلمة اليوم',
      noFavorites: 'لا توجد مفضلات بعد. انقر على أيقونة القلب في التلميحات لإضافة كلمات!',
      noRecentSearches: 'لا توجد عمليات بحث حديثة بعد. حدد الكلمات على صفحات الويب لرؤيتها هنا!',
      subscription: 'الاشتراك',
      modalPlacement: 'موضع النافذة',
      apiSettings: 'إعدادات API',
      general: 'عام',
      contact: 'اتصل',
      loadMore: 'تحميل المزيد',
      showLess: 'عرض أقل',
      clearAll: 'مسح الكل',
      allRecentSearches: 'جميع عمليات البحث الأخيرة',
      back: 'رجوع',
      search: 'بحث',
      copy: 'نسخ',
      addToFavorites: 'إضافة إلى المفضلة',
      removeFromFavorites: 'إزالة من المفضلة',
      manageSubscription: 'إدارة الاشتراك',
      sendMessage: 'إرسال رسالة',
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      subject: 'الموضوع',
      message: 'الرسالة',
      yourMessage: 'رسالتك...',
      weWillGetBack: 'سنتواصل معك في أقرب وقت ممكن',
      clearAllData: 'مسح جميع البيانات',
      removeAllData: 'إزالة جميع المفضلات والبحث الأخير والإعدادات',
      loadingFavorites: 'جارٍ تحميل المفضلة...',
      loadingRecent: 'جارٍ تحميل البحث الأخير...',
      loadingWordOfDay: 'جارٍ تحميل كلمة اليوم...',
      errorLoadingWordOfDay: 'خطأ في تحميل كلمة اليوم.',
      searchPlaceholder: 'البحث عن كلمة...',
      searchButton: 'بحث',
      settingsButton: 'الإعدادات',
      autoRenewDesc: 'تجديد اشتراكك تلقائياً عند انتهاء الصلاحية',
      modalPlacementDesc: 'اختر مكان ظهور نافذة شرح الكلمة عند تحديد النص. المخصص يسمح لك بسحب النافذة إلى الموضع المفضل لديك.',
      modalDraggableDesc: 'السماح بسحب النافذة لإعادة وضعها (ستظهر مقبض الإمساك)',
      openaiKeyDesc: 'أضف مفتاح OpenAI API الخاص بك للحصول على شرح محسّن. اتركه فارغاً لاستخدام واجهة برمجة تطبيقات القاموس المجانية.',
      saveApiSettings: 'حفظ إعدادات API',
      incognitoDesc: 'افتراضياً، لا يتم حفظ عمليات البحث في وضع التصفح المتخفي',
      removeAllDataDesc: 'إزالة جميع المفضلات والبحث الأخير والإعدادات',
      contactNamePlaceholder: 'اسمك',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: 'الموضوع',
      autoRenewLabel: 'تجديد الاشتراك تلقائياً',
      statusLabel: 'الحالة:',
      expiresLabel: 'ينتهي:',
      modalPositionLabel: 'موضع النافذة:',
      enableDragLabel: 'تفعيل السحب لإعادة الوضع',
      openaiKeyLabel: 'مفتاح OpenAI API (اختياري):',
      explanationStyleLabel: 'نمط الشرح:',
      saveInIncognitoLabel: 'حفظ عمليات البحث في وضع التصفح المتخفي',
      showPhoneticLabel: 'إظهار النطق الصوتي',
      showExamplesLabel: 'إظهار جمل المثال',
      examplesLabel: 'أمثلة',
      synonymsLabel: 'مرادفات',
      copyWord: 'نسخ الكلمة',
      addToFavorites: 'إضافة إلى المفضلة',
      removeFromFavorites: 'إزالة من المفضلة',
      search: 'بحث',
      refresh: 'تحديث',
      refreshComplete: 'تم تحديث المركز!',
      active: 'نشط',
      inactive: 'غير نشط',
      notAvailable: 'غير متاح',
      issueTypeLabel: 'نوع المشكلة:',
      more: 'المزيد',
      modalIntuitive: 'بديهي (افتراضي)',
      modalTop: 'أعلى التحديد',
      modalBottom: 'أسفل التحديد',
      modalLeft: 'يسار التحديد',
      modalRight: 'يمين التحديد',
      modalCenter: 'وسط الشاشة',
      modalCustom: 'مخصص (اسحب للوضع)',
      stylePlain: 'إنجليزي بسيط',
      styleTechnical: 'تقني',
      styleSimple: 'بسيط (ELI12)',
      issueGeneral: 'استفسار عام',
      issueModalNotWorking: 'النافذة المنبثقة لا تعمل على الصفحة',
      issueWordNotFound: 'الكلمة غير موجودة/غير صحيحة',
      issueSubscription: 'مشكلة الاشتراك',
      issueBug: 'تقرير خطأ',
      issueFeature: 'طلب ميزة',
      issueOther: 'أخرى',
      contactNamePlaceholder: 'اسمك',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'رسالتك...',
      recentNews: 'الأخبار الحديثة'
    },
    hi: {
      settings: 'सेटिंग्स',
      favorites: 'पसंदीदा',
      recentSearches: 'हाल की खोजें',
      wordOfDay: 'दिन का शब्द',
      noFavorites: 'अभी तक कोई पसंदीदा नहीं। शब्द जोड़ने के लिए टूलटिप में दिल आइकन पर क्लिक करें!',
      noRecentSearches: 'अभी तक कोई हाल की खोज नहीं। यहां देखने के लिए वेब पेज पर शब्द चुनें!',
      subscription: 'सदस्यता',
      modalPlacement: 'मोडल स्थान',
      apiSettings: 'API सेटिंग्स',
      general: 'सामान्य',
      contact: 'संपर्क',
      loadMore: 'और लोड करें',
      showLess: 'कम दिखाएं',
      clearAll: 'सभी साफ करें',
      allRecentSearches: 'सभी हाल की खोजें',
      back: 'वापस',
      search: 'खोजें',
      copy: 'कॉपी करें',
      addToFavorites: 'पसंदीदा में जोड़ें',
      removeFromFavorites: 'पसंदीदा से हटाएं',
      manageSubscription: 'सदस्यता प्रबंधन',
      sendMessage: 'संदेश भेजें',
      name: 'नाम',
      email: 'ईमेल',
      subject: 'विषय',
      message: 'संदेश',
      yourMessage: 'आपका संदेश...',
      weWillGetBack: 'हम जल्द से जल्द आपसे संपर्क करेंगे',
      clearAllData: 'सभी डेटा साफ करें',
      removeAllData: 'सभी पसंदीदा, हाल की खोजें और सेटिंग्स हटाएं',
      loadingFavorites: 'पसंदीदा लोड हो रहे हैं...',
      loadingRecent: 'हाल की खोजें लोड हो रही हैं...',
      loadingWordOfDay: 'दिन का शब्द लोड हो रहा है...',
      errorLoadingWordOfDay: 'दिन का शब्द लोड करने में त्रुटि।',
      searchPlaceholder: 'एक शब्द खोजें...',
      searchButton: 'खोजें',
      settingsButton: 'सेटिंग्स',
      autoRenewDesc: 'समाप्ति पर अपनी सदस्यता को स्वचालित रूप से नवीनीकृत करें',
      modalPlacementDesc: 'चुनें कि पाठ चुनने पर शब्द स्पष्टीकरण मोडल कहाँ दिखाई देता है। कस्टम आपको मोडल को अपनी पसंदीदा स्थिति में खींचने की अनुमति देता है।',
      modalDraggableDesc: 'मोडल को पुनः स्थिति में लाने के लिए खींचने की अनुमति दें (ग्रैबर हैंडल दिखाई देगा)',
      openaiKeyDesc: 'बेहतर स्पष्टीकरण के लिए अपनी OpenAI API कुंजी जोड़ें। मुफ्त शब्दकोश API का उपयोग करने के लिए खाली छोड़ दें।',
      saveApiSettings: 'API सेटिंग्स सहेजें',
      incognitoDesc: 'डिफ़ॉल्ट रूप से, गुप्त मोड में खोज सहेजी नहीं जाती हैं',
      removeAllDataDesc: 'सभी पसंदीदा, हाल की खोजें और सेटिंग्स हटाएं',
      contactNamePlaceholder: 'आपका नाम',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: 'विषय',
      autoRenewLabel: 'सदस्यता स्वचालित रूप से नवीनीकृत करें',
      statusLabel: 'स्थिति:',
      expiresLabel: 'समाप्त:',
      modalPositionLabel: 'मोडल स्थान:',
      enableDragLabel: 'पुनः स्थिति के लिए खींचना सक्षम करें',
      openaiKeyLabel: 'OpenAI API कुंजी (वैकल्पिक):',
      explanationStyleLabel: 'स्पष्टीकरण शैली:',
      saveInIncognitoLabel: 'गुप्त मोड में खोज सहेजें',
      showPhoneticLabel: 'ध्वन्यात्मक उच्चारण दिखाएं',
      showExamplesLabel: 'उदाहरण वाक्य दिखाएं',
      examplesLabel: 'उदाहरण',
      synonymsLabel: 'समानार्थी',
      copyWord: 'शब्द कॉपी करें',
      addToFavorites: 'पसंदीदा में जोड़ें',
      removeFromFavorites: 'पसंदीदा से हटाएं',
      search: 'खोजें',
      refresh: 'ताज़ा करें',
      refreshComplete: 'हब ताज़ा हो गया!',
      active: 'सक्रिय',
      inactive: 'निष्क्रिय',
      notAvailable: 'उपलब्ध नहीं',
      issueTypeLabel: 'समस्या का प्रकार:',
      more: 'अधिक',
      modalIntuitive: 'सहज (डिफ़ॉल्ट)',
      modalTop: 'चयन के ऊपर',
      modalBottom: 'चयन के नीचे',
      modalLeft: 'चयन के बाएं',
      modalRight: 'चयन के दाएं',
      modalCenter: 'स्क्रीन का केंद्र',
      modalCustom: 'कस्टम (स्थिति के लिए खींचें)',
      stylePlain: 'सरल अंग्रेजी',
      styleTechnical: 'तकनीकी',
      styleSimple: 'सरल (ELI12)',
      issueGeneral: 'सामान्य पूछताछ',
      issueModalNotWorking: 'पृष्ठ पर मोडल काम नहीं कर रहा',
      issueWordNotFound: 'शब्द नहीं मिला/गलत',
      issueSubscription: 'सदस्यता समस्या',
      issueBug: 'बग रिपोर्ट',
      issueFeature: 'फ़ीचर अनुरोध',
      issueOther: 'अन्य',
      contactNamePlaceholder: 'आपका नाम',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'आपका संदेश...',
      recentNews: 'हाल की खबरें'
    },
    nl: {
      settings: 'Instellingen',
      favorites: 'Favorieten',
      recentSearches: 'Recente Zoekopdrachten',
      wordOfDay: 'Woord van de Dag',
      noFavorites: 'Nog geen favorieten. Klik op het hartpictogram in de tooltips om woorden toe te voegen!',
      noRecentSearches: 'Nog geen recente zoekopdrachten. Selecteer woorden op webpagina\'s om ze hier te zien!',
      subscription: 'Abonnement',
      modalPlacement: 'Modal Positie',
      apiSettings: 'API Instellingen',
      general: 'Algemeen',
      contact: 'Contact',
      loadMore: 'Meer Laden',
      showLess: 'Minder Tonen',
      clearAll: 'Alles Wissen',
      allRecentSearches: 'Alle Recente Zoekopdrachten',
      back: 'Terug',
      search: 'Zoeken',
      copy: 'Kopiëren',
      addToFavorites: 'Toevoegen aan favorieten',
      removeFromFavorites: 'Verwijderen uit favorieten',
      manageSubscription: 'Abonnement Beheren',
      sendMessage: 'Bericht Verzenden',
      name: 'Naam',
      email: 'E-mail',
      subject: 'Onderwerp',
      message: 'Bericht',
      yourMessage: 'Uw bericht...',
      weWillGetBack: 'We nemen zo spoedig mogelijk contact met u op',
      clearAllData: 'Alle Gegevens Wissen',
      removeAllData: 'Verwijder alle favorieten, recente zoekopdrachten en instellingen',
      loadingFavorites: 'Favorieten laden...',
      loadingRecent: 'Recente zoekopdrachten laden...',
      loadingWordOfDay: 'Woord van de dag laden...',
      errorLoadingWordOfDay: 'Fout bij het laden van het woord van de dag.',
      searchPlaceholder: 'Zoek naar een woord...',
      searchButton: 'Zoeken',
      settingsButton: 'Instellingen',
      autoRenewDesc: 'Uw abonnement automatisch verlengen wanneer het verloopt',
      modalPlacementDesc: 'Kies waar het woordverklaring modal verschijnt wanneer u tekst selecteert. Aangepast stelt u in staat het modal naar uw voorkeurspositie te slepen.',
      modalDraggableDesc: 'Toestaan dat het modal wordt gesleept om het te herpositioneren (een greep verschijnt)',
      openaiKeyDesc: 'Voeg uw OpenAI API-sleutel toe voor verbeterde verklaringen. Laat leeg om de gratis woordenboek API te gebruiken.',
      saveApiSettings: 'API Instellingen Opslaan',
      incognitoDesc: 'Standaard worden zoekopdrachten niet opgeslagen in incognitomodus',
      removeAllDataDesc: 'Verwijder alle favorieten, recente zoekopdrachten en instellingen',
      contactNamePlaceholder: 'Uw naam',
      contactEmailPlaceholder: 'uw.email@voorbeeld.com',
      contactSubjectPlaceholder: 'Onderwerp',
      autoRenewLabel: 'Abonnement automatisch verlengen',
      statusLabel: 'Status:',
      expiresLabel: 'Verloopt:',
      modalPositionLabel: 'Modal Positie:',
      enableDragLabel: 'Slepen om te herpositioneren inschakelen',
      openaiKeyLabel: 'OpenAI API-sleutel (Optioneel):',
      explanationStyleLabel: 'Uitlegstijl:',
      saveInIncognitoLabel: 'Zoekopdrachten opslaan in incognitomodus',
      showPhoneticLabel: 'Fonetische uitspraak tonen',
      showExamplesLabel: 'Voorbeeldzinnen tonen',
      examplesLabel: 'Voorbeelden',
      synonymsLabel: 'Synoniemen',
      copyWord: 'Woord kopiëren',
      addToFavorites: 'Toevoegen aan favorieten',
      removeFromFavorites: 'Verwijderen uit favorieten',
      search: 'Zoeken',
      refresh: 'Vernieuwen',
      refreshComplete: 'Hub vernieuwd!',
      active: 'Actief',
      inactive: 'Inactief',
      notAvailable: 'N/B',
      issueTypeLabel: 'Probleemtype:',
      more: 'meer',
      modalIntuitive: 'Intuïtief (Standaard)',
      modalTop: 'Boven Selectie',
      modalBottom: 'Onder Selectie',
      modalLeft: 'Links van Selectie',
      modalRight: 'Rechts van Selectie',
      modalCenter: 'Midden van Scherm',
      modalCustom: 'Aangepast (Sleep om te Positioneren)',
      stylePlain: 'Eenvoudig Engels',
      styleTechnical: 'Technisch',
      styleSimple: 'Eenvoudig (ELI12)',
      issueGeneral: 'Algemene Vraag',
      issueModalNotWorking: 'Modal Werkt Niet op Pagina',
      issueWordNotFound: 'Woord Niet Gevonden/Onjuist',
      issueSubscription: 'Abonnement Probleem',
      issueBug: 'Bug Rapport',
      issueFeature: 'Functie Verzoek',
      issueOther: 'Anders',
      contactNamePlaceholder: 'Uw naam',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Uw bericht...',
      recentNews: 'Recente Nieuws'
    },
    sv: {
      settings: 'Inställningar',
      favorites: 'Favoriter',
      recentSearches: 'Senaste Sökningar',
      wordOfDay: 'Dagens Ord',
      noFavorites: 'Inga favoriter ännu. Klicka på hjärtikonen i tooltips för att lägga till ord!',
      noRecentSearches: 'Inga senaste sökningar ännu. Välj ord på webbsidor för att se dem här!',
      subscription: 'Prenumeration',
      modalPlacement: 'Modal Position',
      apiSettings: 'API Inställningar',
      general: 'Allmänt',
      contact: 'Kontakt',
      loadMore: 'Ladda Mer',
      showLess: 'Visa Mindre',
      clearAll: 'Rensa Allt',
      allRecentSearches: 'Alla Senaste Sökningar',
      back: 'Tillbaka',
      search: 'Sök',
      copy: 'Kopiera',
      addToFavorites: 'Lägg till i favoriter',
      removeFromFavorites: 'Ta bort från favoriter',
      manageSubscription: 'Hantera Prenumeration',
      sendMessage: 'Skicka Meddelande',
      name: 'Namn',
      email: 'E-post',
      subject: 'Ämne',
      message: 'Meddelande',
      yourMessage: 'Ditt meddelande...',
      weWillGetBack: 'Vi återkommer så snart som möjligt',
      clearAllData: 'Rensa Alla Data',
      removeAllData: 'Ta bort alla favoriter, senaste sökningar och inställningar',
      loadingFavorites: 'Laddar favoriter...',
      loadingRecent: 'Laddar senaste sökningar...',
      loadingWordOfDay: 'Laddar dagens ord...',
      errorLoadingWordOfDay: 'Fel vid laddning av dagens ord.',
      autoRenewLabel: 'Förnya prenumeration automatiskt',
      statusLabel: 'Status:',
      expiresLabel: 'Upphör:',
      modalPositionLabel: 'Modal Position:',
      enableDragLabel: 'Aktivera dra för att flytta',
      openaiKeyLabel: 'OpenAI API-nyckel (Valfritt):',
      explanationStyleLabel: 'Förklaringsstil:',
      saveInIncognitoLabel: 'Spara sökningar i inkognitoläge',
      showPhoneticLabel: 'Visa fonetisk uttal',
      showExamplesLabel: 'Visa exempelmeningar',
      examplesLabel: 'Exempel',
      synonymsLabel: 'Synonymer',
      copyWord: 'Kopiera ord',
      addToFavorites: 'Lägg till i favoriter',
      removeFromFavorites: 'Ta bort från favoriter',
      search: 'Sök',
      refresh: 'Uppdatera',
      refreshComplete: 'Hub uppdaterad!',
      active: 'Aktiv',
      inactive: 'Inaktiv',
      notAvailable: 'Saknas',
      issueTypeLabel: 'Problemtyp:',
      more: 'mer',
      modalIntuitive: 'Intuitiv (Standard)',
      modalTop: 'Ovanför Markering',
      modalBottom: 'Under Markering',
      modalLeft: 'Vänster om Markering',
      modalRight: 'Höger om Markering',
      modalCenter: 'Skärmens Centrum',
      modalCustom: 'Anpassad (Dra för att Positionera)',
      stylePlain: 'Enkelt Engelska',
      styleTechnical: 'Teknisk',
      styleSimple: 'Enkel (ELI12)',
      issueGeneral: 'Allmän Förfrågan',
      issueModalNotWorking: 'Modal Fungerar Inte på Sidan',
      issueWordNotFound: 'Ord Hittades Inte/Felaktigt',
      issueSubscription: 'Prenumerationsproblem',
      issueBug: 'Felrapport',
      issueFeature: 'Funktionsförfrågan',
      issueOther: 'Annat',
      contactNamePlaceholder: 'Ditt namn',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Ditt meddelande...',
      recentNews: 'Senaste Nyheter'
    },
    pl: {
      settings: 'Ustawienia',
      favorites: 'Ulubione',
      recentSearches: 'Ostatnie Wyszukiwania',
      wordOfDay: 'Słowo Dnia',
      noFavorites: 'Brak ulubionych. Kliknij ikonę serca w podpowiedziach, aby dodać słowa!',
      noRecentSearches: 'Brak ostatnich wyszukiwań. Wybierz słowa na stronach internetowych, aby je tutaj zobaczyć!',
      subscription: 'Subskrypcja',
      modalPlacement: 'Pozycja Modala',
      apiSettings: 'Ustawienia API',
      general: 'Ogólne',
      contact: 'Kontakt',
      loadMore: 'Załaduj Więcej',
      showLess: 'Pokaż Mniej',
      clearAll: 'Wyczyść Wszystko',
      allRecentSearches: 'Wszystkie Ostatnie Wyszukiwania',
      back: 'Wstecz',
      search: 'Szukaj',
      copy: 'Kopiuj',
      addToFavorites: 'Dodaj do ulubionych',
      removeFromFavorites: 'Usuń z ulubionych',
      manageSubscription: 'Zarządzaj Subskrypcją',
      sendMessage: 'Wyślij Wiadomość',
      name: 'Imię',
      email: 'Email',
      subject: 'Temat',
      message: 'Wiadomość',
      yourMessage: 'Twoja wiadomość...',
      weWillGetBack: 'Skontaktujemy się z Tobą tak szybko, jak to możliwe',
      clearAllData: 'Wyczyść Wszystkie Dane',
      removeAllData: 'Usuń wszystkie ulubione, ostatnie wyszukiwania i ustawienia',
      loadingFavorites: 'Ładowanie ulubionych...',
      loadingRecent: 'Ładowanie ostatnich wyszukiwań...',
      loadingWordOfDay: 'Ładowanie słowa dnia...',
      errorLoadingWordOfDay: 'Błąd podczas ładowania słowa dnia.',
      searchPlaceholder: 'Szukaj słowa...',
      searchButton: 'Szukaj',
      settingsButton: 'Ustawienia',
      autoRenewDesc: 'Automatycznie odnawiaj subskrypcję po wygaśnięciu',
      modalPlacementDesc: 'Wybierz, gdzie pojawia się modal wyjaśnienia słowa po zaznaczeniu tekstu. Niestandardowy pozwala przeciągnąć modal do preferowanej pozycji.',
      modalDraggableDesc: 'Zezwól na przeciąganie modala w celu zmiany jego pozycji (pojawi się uchwyt)',
      openaiKeyDesc: 'Dodaj swój klucz API OpenAI, aby uzyskać ulepszone wyjaśnienia. Pozostaw puste, aby użyć bezpłatnego API słownika.',
      saveApiSettings: 'Zapisz Ustawienia API',
      incognitoDesc: 'Domyślnie wyszukiwania nie są zapisywane w trybie incognito',
      removeAllDataDesc: 'Usuń wszystkie ulubione, ostatnie wyszukiwania i ustawienia',
      contactNamePlaceholder: 'Twoje imię',
      contactEmailPlaceholder: 'twoj.email@przyklad.com',
      contactSubjectPlaceholder: 'Temat',
      autoRenewLabel: 'Automatycznie odnawiaj subskrypcję',
      statusLabel: 'Status:',
      expiresLabel: 'Wygasa:',
      modalPositionLabel: 'Pozycja Modala:',
      enableDragLabel: 'Włącz przeciąganie do zmiany pozycji',
      openaiKeyLabel: 'Klucz API OpenAI (Opcjonalny):',
      explanationStyleLabel: 'Styl Wyjaśnienia:',
      saveInIncognitoLabel: 'Zapisz wyszukiwania w trybie incognito',
      showPhoneticLabel: 'Pokaż wymowę fonetyczną',
      showExamplesLabel: 'Pokaż przykładowe zdania',
      examplesLabel: 'Przykłady',
      synonymsLabel: 'Synonimy',
      copyWord: 'Kopiuj słowo',
      addToFavorites: 'Dodaj do ulubionych',
      removeFromFavorites: 'Usuń z ulubionych',
      search: 'Szukaj',
      refresh: 'Odśwież',
      refreshComplete: 'Hub odświeżony!',
      active: 'Aktywny',
      inactive: 'Nieaktywny',
      notAvailable: 'N/D',
      issueTypeLabel: 'Typ Problemu:',
      more: 'więcej',
      modalIntuitive: 'Intuicyjne (Domyślne)',
      modalTop: 'Nad Zaznaczeniem',
      modalBottom: 'Pod Zaznaczeniem',
      modalLeft: 'Na Lewo od Zaznaczenia',
      modalRight: 'Na Prawo od Zaznaczenia',
      modalCenter: 'Środek Ekranu',
      modalCustom: 'Niestandardowe (Przeciągnij, aby Ustawić)',
      stylePlain: 'Prosty Angielski',
      styleTechnical: 'Techniczny',
      styleSimple: 'Prosty (ELI12)',
      issueGeneral: 'Ogólne Zapytanie',
      issueModalNotWorking: 'Modal Nie Działa na Stronie',
      issueWordNotFound: 'Słowo Nie Znalezione/Nieprawidłowe',
      issueSubscription: 'Problem z Subskrypcją',
      issueBug: 'Raport Błędu',
      issueFeature: 'Prośba o Funkcję',
      issueOther: 'Inne',
      contactNamePlaceholder: 'Twoje imię',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Twoja wiadomość...',
      recentNews: 'Najnowsze Wiadomości'
    }
  };
  
  // Detect browser language and map to dictionary language code
  function detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    const langCode = browserLang.split('-')[0].toLowerCase();
    
    // Map browser language to supported dictionary languages
    const supportedLanguages = {
      'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it', 'pt': 'pt',
      'ru': 'ru', 'ja': 'ja', 'zh': 'zh', 'ko': 'ko', 'ar': 'ar', 'hi': 'hi',
      'nl': 'nl', 'sv': 'sv', 'pl': 'pl', 'tr': 'tr'
    };
    
    return supportedLanguages[langCode] || 'en';
  }
  
  // Get current UI language
  function getUILanguage() {
    return document.documentElement.lang || 'en';
  }
  
  // Translate UI text - comprehensive function
  function translateUI(lang = 'en') {
    try {
      const t = translations[lang] || translations.en;
      if (!t) {
        console.error('Nimbus: No translations found for language:', lang);
        return;
      }
      window.currentUILanguage = lang;
      document.documentElement.lang = lang;
      
      console.log('Nimbus: Translating UI to', lang);
    
    // Translate by data-i18n attributes
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = t[key];
        } else {
          el.textContent = t[key];
        }
      }
    });
    
    // Search input placeholder
    const searchInput = document.getElementById('searchInput');
    if (searchInput && t.searchPlaceholder) {
      searchInput.placeholder = t.searchPlaceholder;
    }
    
    // Search button title
    const searchBtn = document.getElementById('searchIconBtn');
    if (searchBtn && t.searchButton) {
      searchBtn.title = t.searchButton;
    }
    
    // Settings button title
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn && t.settingsButton) {
      settingsBtn.title = t.settingsButton;
    }
    
    // Translate specific elements by ID/class/selector
    const translationsMap = {
      '#settingsPage h2': t.settings,
      '[data-tab="subscription"] span': t.subscription,
      '[data-tab="modal"] span': t.modalPlacement,
      '[data-tab="api"] span': t.apiSettings,
      '[data-tab="general"] span': t.general,
      '[data-tab="contact"] span': t.contact,
      '#favorites .section-title span': t.favorites,
      '#recent .section-title span': t.recentSearches,
      '.word-of-day-title': t.wordOfDay,
      '#loadMoreBtn': t.loadMore,
      '#showLessBtn': t.showLess,
      '#clearAllBtn': t.clearAll,
      '#manageSubscriptionBtn': t.manageSubscription,
      '#sendContactBtn': t.sendMessage,
      '#clearAllDataBtn': t.clearAllData,
      'label[for="contactName"]': t.name,
      'label[for="contactEmail"]': t.email,
      'label[for="contactSubject"]': t.subject,
      'label[for="contactMessage"]': t.message,
      '#saveApiSettingsBtn': t.saveApiSettings
    };
    
    Object.keys(translationsMap).forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (el.tagName === 'LABEL' && el.querySelector('span')) {
          el.querySelector('span').textContent = translationsMap[selector];
        } else if (el.tagName === 'BUTTON' || el.tagName === 'H2' || el.tagName === 'SPAN' || el.tagName === 'DIV') {
          // Only update if it's a direct text element or button
          if (el.tagName === 'BUTTON' || !el.querySelector('span')) {
            el.textContent = translationsMap[selector];
          } else if (el.querySelector('span')) {
            el.querySelector('span').textContent = translationsMap[selector];
          }
        }
      });
    });
    
    // Translate placeholders
    const contactName = document.getElementById('contactName');
    if (contactName && t.contactNamePlaceholder) {
      contactName.placeholder = t.contactNamePlaceholder;
    }
    
    const contactEmail = document.getElementById('contactEmail');
    if (contactEmail && t.contactEmailPlaceholder) {
      contactEmail.placeholder = t.contactEmailPlaceholder;
    }
    
    const contactSubject = document.getElementById('contactSubject');
    if (contactSubject && t.contactSubjectPlaceholder) {
      contactSubject.placeholder = t.contactSubjectPlaceholder;
    }
    
    const contactMessage = document.getElementById('contactMessage');
    if (contactMessage && t.yourMessage) {
      contactMessage.placeholder = t.yourMessage;
    }
    
    // Translate descriptions - use multiple approaches to ensure we catch them all
    const descriptions = [
      { selector: '#autoRenewToggle + .settings-description', key: 'autoRenewDesc', fallback: 'Automatically renew your subscription when it expires' },
      { selector: '#modalPlacement + .settings-description', key: 'modalPlacementDesc', fallback: 'Choose where the word explanation modal appears' },
      { selector: '#modalPlacementDropdown + .settings-description', key: 'modalPlacementDesc', fallback: 'Choose where the word explanation modal appears' },
      { selector: '#modalDraggable + .settings-description', key: 'modalDraggableDesc', fallback: 'Allow dragging the modal to reposition it' },
      { selector: '#openaiKeyInput + .settings-description', key: 'openaiKeyDesc', fallback: 'Add your OpenAI API key for enhanced explanations' },
      { selector: '#saveInIncognito + .settings-description', key: 'incognitoDesc', fallback: 'By default, searches are not saved in incognito mode' },
      { selector: '#clearAllDataBtn + .settings-description', key: 'removeAllDataDesc', fallback: 'Remove all favorites, recent searches, and settings' },
      { selector: '#sendContactBtn + .settings-description', key: 'weWillGetBack', fallback: 'We\'ll get back to you as soon as possible' }
    ];
    
    descriptions.forEach(({ selector, key, fallback }) => {
      const el = document.querySelector(selector);
      if (el && t[key]) {
        el.textContent = t[key];
      }
    });
    
    // Also translate descriptions by matching text content (fallback method)
    document.querySelectorAll('.settings-description').forEach(desc => {
      const text = desc.textContent.trim();
      if (text.includes('Automatically renew your subscription when it expires')) {
        desc.textContent = t.autoRenewDesc;
      } else if (text.includes('Choose where the word explanation modal appears')) {
        desc.textContent = t.modalPlacementDesc;
      } else if (text.includes('Allow dragging the modal to reposition it')) {
        desc.textContent = t.modalDraggableDesc;
      } else if (text.includes('Add your OpenAI API key for enhanced explanations')) {
        desc.textContent = t.openaiKeyDesc;
      } else if (text.includes('By default, searches are not saved in incognito mode')) {
        desc.textContent = t.incognitoDesc;
      } else if (text.includes('Remove all favorites, recent searches, and settings')) {
        desc.textContent = t.removeAllDataDesc;
      } else if (text.includes('We\'ll get back to you as soon as possible')) {
        desc.textContent = t.weWillGetBack;
      }
    });
    
    // Translate empty states
    document.querySelectorAll('.empty-state').forEach(el => {
      if (el.closest('#favorites')) {
        el.textContent = t.noFavorites;
      } else if (el.closest('#recent')) {
        el.textContent = t.noRecentSearches;
      }
    });
    
    // Translate loading messages
    document.querySelectorAll('.loading').forEach(el => {
      if (el.closest('#favorites')) {
        el.textContent = t.loadingFavorites;
      } else if (el.closest('#recent')) {
        el.textContent = t.loadingRecent;
      } else if (el.closest('#wordOfDay')) {
        el.textContent = t.loadingWordOfDay;
      }
    });
    
    // Force update word of day title if it exists
    const wordOfDayTitle = document.querySelector('.word-of-day-title');
    if (wordOfDayTitle) {
      wordOfDayTitle.textContent = t.wordOfDay;
    }
    
    // Update section titles
    const favoritesTitle = document.querySelector('#favorites').closest('.section')?.querySelector('.section-title span');
    if (favoritesTitle) favoritesTitle.textContent = t.favorites;
    
    const recentTitle = document.querySelector('#recent').closest('.section')?.querySelector('.section-title span');
    if (recentTitle) recentTitle.textContent = t.recentSearches;
    
    // Translate labels
    const labelTranslations = {
      '#autoRenewToggle + span': t.autoRenewLabel,
      'label:has(#modalPlacement)': t.modalPositionLabel,
      'label:contains("Modal Position:")': t.modalPositionLabel,
      '#modalPlacementDropdown': t.modalPositionLabel,
      '#modalDraggable + span': t.enableDragLabel,
      'label:has(#openaiKeyInput)': t.openaiKeyLabel,
      'label:contains("OpenAI API Key")': t.openaiKeyLabel,
      'label:has(#explanationStyle)': t.explanationStyleLabel,
      'label:contains("Explanation Style:")': t.explanationStyleLabel,
      '#saveInIncognito + span': t.saveInIncognitoLabel,
      '#showPhonetic + span': t.showPhoneticLabel,
      '#showExamples + span': t.showExamplesLabel,
      'label:has(#contactIssueType)': t.issueTypeLabel,
      'label:contains("Issue Type:")': t.issueTypeLabel
    };
    
    // Also translate labels that are direct text nodes
    document.querySelectorAll('label').forEach(label => {
      const text = label.textContent.trim();
      if (text === 'Modal Position:') {
        label.textContent = t.modalPositionLabel;
      } else if (text === 'OpenAI API Key (Optional):') {
        label.textContent = t.openaiKeyLabel;
      } else if (text === 'Explanation Style:') {
        label.textContent = t.explanationStyleLabel;
      } else if (text === 'Issue Type:') {
        label.textContent = t.issueTypeLabel;
      }
    });
    
    Object.keys(labelTranslations).forEach(selector => {
      const el = document.querySelector(selector);
      if (el && labelTranslations[selector]) {
        if (el.tagName === 'LABEL' && el.querySelector('span')) {
          el.querySelector('span').textContent = labelTranslations[selector];
        } else if (el.tagName === 'SPAN') {
          el.textContent = labelTranslations[selector];
        } else if (el.tagName === 'LABEL') {
          // For labels without spans, update the text after the input
          const span = el.querySelector('span');
          if (span) {
            span.textContent = labelTranslations[selector];
          } else {
            // If no span, find text node or create one
            const textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
            if (textNode) {
              textNode.textContent = labelTranslations[selector];
            }
          }
        }
      }
    });
    
    // Translate status labels and values (special handling) - synchronous
    const statusElement = document.getElementById('subscriptionStatus');
    const expiresElement = document.getElementById('subscriptionExpiry');
    const statusLabelSpan = document.querySelector('.subscription-status span:first-child');
    const expiresLabelSpan = document.querySelector('.subscription-status span:last-child');
    
    if (statusLabelSpan && t.statusLabel) {
      // Get current status from element or default to inactive
      let isActive = false;
      if (statusElement) {
        isActive = statusElement.style.color === 'rgb(16, 185, 129)' || 
                   statusElement.textContent === translations.en.active ||
                   statusElement.textContent === translations.es?.active ||
                   statusElement.textContent === translations.fr?.active ||
                   statusElement.textContent === translations.de?.active;
      }
      const statusValue = isActive ? t.active : t.inactive;
      if (statusElement) {
        statusElement.textContent = statusValue;
        statusElement.style.color = isActive ? '#10b981' : '#ef4444';
      }
      statusLabelSpan.innerHTML = t.statusLabel + ' <strong id="subscriptionStatus">' + statusValue + '</strong>';
    }
    
    if (expiresLabelSpan && t.expiresLabel) {
      // Get current expiry value or default to N/A
      let expiryValue = t.notAvailable;
      if (expiresElement) {
        const currentExpiry = expiresElement.textContent.trim();
        // If it's a date (contains numbers and slashes/dashes), keep it
        if (currentExpiry.match(/\d/) && (currentExpiry.includes('/') || currentExpiry.includes('-') || currentExpiry.length > 5)) {
          expiryValue = currentExpiry;
        }
      }
      if (expiresElement) {
        expiresElement.textContent = expiryValue;
      }
      expiresLabelSpan.innerHTML = t.expiresLabel + ' <strong id="subscriptionExpiry">' + expiryValue + '</strong>';
    }
    
    // Translate dropdown options - simple and immediate
    // Modal placement dropdown
    const modalPlacementOptions = document.querySelectorAll('#modalPlacementDropdown .custom-dropdown-option');
    if (modalPlacementOptions.length > 0 && t.modalIntuitive) {
      const optionMap = {
        'intuitive': t.modalIntuitive,
        'top': t.modalTop,
        'bottom': t.modalBottom,
        'left': t.modalLeft,
        'right': t.modalRight,
        'center': t.modalCenter,
        'custom': t.modalCustom
      };
      modalPlacementOptions.forEach(option => {
        const value = option.dataset.value;
        if (optionMap[value]) {
          option.textContent = optionMap[value];
        }
      });
      // Update selected text
      const modalPlacementSelected = document.querySelector('#modalPlacementDropdown .custom-dropdown-text');
      const modalPlacementValue = document.getElementById('modalPlacement')?.value;
      if (modalPlacementSelected && modalPlacementValue && optionMap[modalPlacementValue]) {
        modalPlacementSelected.textContent = optionMap[modalPlacementValue];
      }
    }
    
    // Explanation style dropdown
    const explanationStyleOptions = document.querySelectorAll('#explanationStyleDropdown .custom-dropdown-option');
    if (explanationStyleOptions.length > 0 && t.stylePlain) {
      const styleMap = {
        'plain': t.stylePlain,
        'technical': t.styleTechnical,
        'simple': t.styleSimple
      };
      explanationStyleOptions.forEach(option => {
        const value = option.dataset.value;
        if (styleMap[value]) {
          option.textContent = styleMap[value];
        }
      });
      // Update selected text
      const explanationStyleSelected = document.querySelector('#explanationStyleDropdown .custom-dropdown-text');
      const explanationStyleValue = document.getElementById('explanationStyle')?.value;
      if (explanationStyleSelected && explanationStyleValue && styleMap[explanationStyleValue]) {
        explanationStyleSelected.textContent = styleMap[explanationStyleValue];
      }
    }
    
    // Issue type dropdown
    const issueTypeOptions = document.querySelectorAll('#contactIssueTypeDropdown .custom-dropdown-option');
    if (issueTypeOptions.length > 0 && t.issueGeneral) {
      const issueMap = {
        'general': t.issueGeneral,
        'modal-not-working': t.issueModalNotWorking,
        'word-not-found': t.issueWordNotFound,
        'subscription': t.issueSubscription,
        'bug': t.issueBug,
        'feature': t.issueFeature,
        'other': t.issueOther
      };
      issueTypeOptions.forEach(option => {
        const value = option.dataset.value;
        if (issueMap[value]) {
          option.textContent = issueMap[value];
        }
      });
      // Update selected text
      const issueTypeSelected = document.querySelector('#contactIssueTypeDropdown .custom-dropdown-text');
      const issueTypeValue = document.getElementById('contactIssueType')?.value;
      if (issueTypeSelected && issueTypeValue && issueMap[issueTypeValue]) {
        issueTypeSelected.textContent = issueMap[issueTypeValue];
      }
    }
    
    // Translate placeholders
    const contactNameInput = document.getElementById('contactName');
    if (contactNameInput && t.contactNamePlaceholder) {
      contactNameInput.placeholder = t.contactNamePlaceholder;
    }
    
    const contactEmailInput = document.getElementById('contactEmail');
    if (contactEmailInput && t.contactEmailPlaceholder) {
      contactEmailInput.placeholder = t.contactEmailPlaceholder;
    }
    
    // Translate "We'll get back to you" message
    const weWillGetBackMsg = document.querySelector('#sendContactBtn + .settings-description');
    if (weWillGetBackMsg && t.weWillGetBack) {
      weWillGetBackMsg.textContent = t.weWillGetBack;
    }
    
    // Translate all settings descriptions (fallback method - also check by text content)
    const allDescriptions = document.querySelectorAll('.settings-description');
    allDescriptions.forEach(desc => {
      const text = desc.textContent.trim();
      // Match descriptions by their English text
      if (text.includes('Automatically renew your subscription when it expires')) {
        desc.textContent = t.autoRenewDesc;
      } else if (text.includes('Choose where the word explanation modal appears')) {
        desc.textContent = t.modalPlacementDesc;
      } else if (text.includes('Allow dragging the modal to reposition it')) {
        desc.textContent = t.modalDraggableDesc;
      } else if (text.includes('Add your OpenAI API key for enhanced explanations')) {
        desc.textContent = t.openaiKeyDesc;
      } else if (text.includes('By default, searches are not saved in incognito mode')) {
        desc.textContent = t.incognitoDesc;
      } else if (text.includes('Remove all favorites, recent searches, and settings')) {
        desc.textContent = t.removeAllDataDesc;
      } else if (text.includes('We\'ll get back to you as soon as possible')) {
        desc.textContent = t.weWillGetBack;
      }
    });
    
      console.log('Nimbus: UI translation complete for', lang);
    } catch (e) {
      console.error('Nimbus: Error in translateUI:', e);
      // Don't throw - allow the app to continue functioning
    }
  }
  
  function loadSettings() {
    chrome.storage.local.get(['settings', 'subscription'], (result) => {
      const settings = result.settings || {};
      const subscription = result.subscription || {};
      
      // Language selector - detect browser language if not set
      const languageInput = document.getElementById('dictionaryLanguage');
      const languageDropdown = document.getElementById('languageDropdown');
      if (languageInput && languageDropdown) {
        const savedLanguage = settings.dictionaryLanguage || detectBrowserLanguage();
        languageInput.value = savedLanguage;
        const textSpan = languageDropdown.querySelector('.custom-dropdown-text');
        const options = languageDropdown.querySelectorAll('.custom-dropdown-option');
        const selectedOption = Array.from(options).find(opt => opt.dataset.value === savedLanguage);
        if (selectedOption && textSpan) {
          textSpan.textContent = selectedOption.textContent.trim();
          options.forEach(opt => opt.classList.remove('selected'));
          selectedOption.classList.add('selected');
        }
        // Re-initialize dropdown after setting value
        setTimeout(() => {
          initCustomDropdowns();
        }, 50);
        
        // Translate UI to saved language
        window.currentUILanguage = savedLanguage;
        translateUI(savedLanguage);
      }
      
      // Also translate UI on initial load
      const initialLang = settings.dictionaryLanguage || detectBrowserLanguage();
      window.currentUILanguage = initialLang;
      translateUI(initialLang);
      
      // Subscription tab
      if (document.getElementById('autoRenewToggle')) {
        document.getElementById('autoRenewToggle').checked = settings.autoRenew !== false;
      }
      // Update subscription status with translated labels - call translateUI to ensure it's translated
      const currentLang = window.currentUILanguage || settings.dictionaryLanguage || 'en';
      translateUI(currentLang);
      
      // Modal placement tab - update custom dropdown
      const modalPlacementInput = document.getElementById('modalPlacement');
      const modalPlacementDropdown = document.getElementById('modalPlacementDropdown');
      if (modalPlacementInput && modalPlacementDropdown) {
        const value = settings.modalPlacement || 'intuitive';
        modalPlacementInput.value = value;
        const textSpan = modalPlacementDropdown.querySelector('.custom-dropdown-text');
        const options = modalPlacementDropdown.querySelectorAll('.custom-dropdown-option');
        const selectedOption = Array.from(options).find(opt => opt.dataset.value === value);
        if (selectedOption && textSpan) {
          textSpan.textContent = selectedOption.textContent.trim();
          options.forEach(opt => opt.classList.remove('selected'));
          selectedOption.classList.add('selected');
        }
        // Auto-enable draggable if custom is selected
        if (value === 'custom') {
          if (document.getElementById('modalDraggable')) {
            document.getElementById('modalDraggable').checked = true;
          }
        }
        // Re-initialize dropdown after setting value
        setTimeout(() => {
          initCustomDropdowns();
        }, 50);
      }
      if (document.getElementById('modalDraggable')) {
        document.getElementById('modalDraggable').checked = settings.modalDraggable !== false;
      }
      
      // API settings tab
      if (document.getElementById('openaiKeyInput')) {
        chrome.storage.local.get(['openaiKey'], (r) => {
          document.getElementById('openaiKeyInput').value = r.openaiKey || '';
        });
      }
      // Explanation style - update custom dropdown
      const explanationStyleInput = document.getElementById('explanationStyle');
      const explanationStyleDropdown = document.getElementById('explanationStyleDropdown');
      if (explanationStyleInput && explanationStyleDropdown) {
        const value = settings.explanationStyle || 'plain';
        explanationStyleInput.value = value;
        const textSpan = explanationStyleDropdown.querySelector('.custom-dropdown-text');
        const options = explanationStyleDropdown.querySelectorAll('.custom-dropdown-option');
        const selectedOption = Array.from(options).find(opt => opt.dataset.value === value);
        if (selectedOption && textSpan) {
          textSpan.textContent = selectedOption.textContent.trim();
          options.forEach(opt => opt.classList.remove('selected'));
          selectedOption.classList.add('selected');
        }
        // Re-initialize dropdown after setting value
        setTimeout(() => {
          initCustomDropdowns();
        }, 50);
      }
      
      // General tab
      if (document.getElementById('saveInIncognito')) {
        document.getElementById('saveInIncognito').checked = settings.saveInIncognito === true;
      }
      if (document.getElementById('showPhonetic')) {
        document.getElementById('showPhonetic').checked = settings.showPhonetic !== false;
      }
      if (document.getElementById('showExamples')) {
        document.getElementById('showExamples').checked = settings.showExamples !== false;
      }
    });
  }
  
  // Save settings
  function saveSettings() {
    // Get values from hidden inputs (custom dropdowns) or regular selects
    const modalPlacementEl = document.getElementById('modalPlacement');
    const explanationStyleEl = document.getElementById('explanationStyle');
    const dictionaryLanguageEl = document.getElementById('dictionaryLanguage');
    
    const dictionaryLanguageValue = dictionaryLanguageEl?.value || detectBrowserLanguage();
    console.log('Nimbus: Saving settings - dictionaryLanguage value:', dictionaryLanguageValue);
    console.log('Nimbus: dictionaryLanguageEl:', dictionaryLanguageEl);
    console.log('Nimbus: dictionaryLanguageEl.value:', dictionaryLanguageEl?.value);
    
    const settings = {
      autoRenew: document.getElementById('autoRenewToggle')?.checked || false,
      modalPlacement: modalPlacementEl?.value || 'intuitive',
      modalDraggable: document.getElementById('modalDraggable')?.checked || false,
      explanationStyle: explanationStyleEl?.value || 'plain',
      dictionaryLanguage: dictionaryLanguageValue,
      saveInIncognito: document.getElementById('saveInIncognito')?.checked || false,
      showPhonetic: document.getElementById('showPhonetic')?.checked !== false,
      showExamples: document.getElementById('showExamples')?.checked !== false
    };
    
    console.log('Nimbus: Full settings object being saved:', JSON.stringify(settings, null, 2));
    
    chrome.storage.local.set({ settings }, () => {
      console.log('Nimbus: Settings saved to storage');
      // Verify it was saved
      chrome.storage.local.get(['settings'], (result) => {
        console.log('Nimbus: Verified saved settings:', JSON.stringify(result.settings, null, 2));
      });
      showNotification('Settings saved successfully!', 'success');
      // Notify content scripts of settings change
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'settingsUpdated', settings });
        }
      });
    });
  }
  
  // Save API settings
  const saveApiSettingsBtn = document.getElementById('saveApiSettingsBtn');
  if (saveApiSettingsBtn) {
    saveApiSettingsBtn.addEventListener('click', () => {
      const openaiKey = document.getElementById('openaiKeyInput').value.trim();
      chrome.storage.local.set({ openaiKey }, () => {
        saveSettings();
        alert('API settings saved!');
      });
    });
  }
  
  // Auto-save settings on change
  document.addEventListener('change', (e) => {
    if (e.target.closest('#settingsPage')) {
      // If custom placement is selected, auto-enable draggable
      if (e.target.id === 'modalPlacement' && e.target.value === 'custom') {
        const draggableCheckbox = document.getElementById('modalDraggable');
        if (draggableCheckbox) {
          draggableCheckbox.checked = true;
        }
      }
      // If dictionary language changed, save immediately and translate UI
      if (e.target.id === 'dictionaryLanguage') {
        const newLang = e.target.value;
        console.log('Nimbus: Language changed to', newLang);
        window.currentUILanguage = newLang;
        saveSettings();
        // Translate immediately - do it twice to catch everything
        translateUI(newLang);
        // Small delay to ensure DOM is ready, then translate again
        setTimeout(() => {
          translateUI(newLang);
        }, 50);
        // Reload all hub content with new language
        loadWordOfDay();
        loadFavorites();
        loadRecent();
        const t = translations[newLang] || translations.en;
        showNotification(t.languageUpdated || 'Language updated!', 'success');
      } else {
        saveSettings();
      }
    }
  });
  
  // Manage subscription button
  const manageSubscriptionBtn = document.getElementById('manageSubscriptionBtn');
  if (manageSubscriptionBtn) {
    manageSubscriptionBtn.addEventListener('click', () => {
      if (chrome && chrome.payments && chrome.payments.getPurchases) {
        chrome.payments.getPurchases((purchases) => {
          if (chrome.runtime.lastError) {
            console.error('Nimbus: Error getting purchases:', chrome.runtime.lastError);
            showNotification('Unable to access subscription. Please try again later.', 'error');
            return;
          }
          // Open Chrome payment management
          chrome.tabs.create({ url: 'https://pay.google.com/gp/v/u/0/home/purchases' });
        });
      } else {
        showNotification('Subscription management is not available in this environment.', 'error');
      }
    });
  }
  
  // Clear all data button
  const clearAllDataBtn = document.getElementById('clearAllDataBtn');
  if (clearAllDataBtn) {
    clearAllDataBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        chrome.storage.local.clear(() => {
          showNotification('All data cleared successfully!', 'success');
          loadFavorites();
          loadRecent();
          loadWordOfDay();
        });
      }
    });
  }
  
  // Contact form handler
  const sendContactBtn = document.getElementById('sendContactBtn');
  if (sendContactBtn) {
    sendContactBtn.addEventListener('click', async () => {
      const name = document.getElementById('contactName').value.trim();
      const email = document.getElementById('contactEmail').value.trim();
      const issueType = document.getElementById('contactIssueType').value;
      const message = document.getElementById('contactMessage').value.trim();
      
      // Get issue type display text
      const issueTypeDropdown = document.getElementById('contactIssueTypeDropdown');
      const issueTypeText = issueTypeDropdown ? issueTypeDropdown.querySelector('.custom-dropdown-text').textContent : 'General Inquiry';
      
      // Validation
      if (!name || !email || !message) {
        showNotification('Please fill in all required fields.', 'error');
        return;
      }
      
      // Create subject from issue type
      const subject = `[${issueTypeText}] Contact Form Submission`;
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        showNotification('Please enter a valid email address.', 'error');
        return;
      }
      
      // Disable button during send
      sendContactBtn.disabled = true;
      const originalText = sendContactBtn.textContent;
      sendContactBtn.textContent = 'Sending...';
      
      try {
        // Send email via background script
        chrome.runtime.sendMessage({
          type: 'sendContactEmail',
          data: {
            name: name,
            email: email,
            subject: subject,
            message: message
          }
        }, (response) => {
          sendContactBtn.disabled = false;
          sendContactBtn.textContent = originalText;
          
          if (chrome.runtime.lastError) {
            console.error('Nimbus: Error sending contact form:', chrome.runtime.lastError);
            // Fallback to mailto
            const recipient = 'charles@leveldesignagency.com';
            const mailtoSubject = encodeURIComponent(`[Nimbus Extension] ${subject}`);
            const mailtoBody = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nIssue Type: ${issueTypeText}\n\nMessage:\n${message}`);
            window.location.href = `mailto:${recipient}?subject=${mailtoSubject}&body=${mailtoBody}`;
            showNotification('Opening email client...', 'success');
            return;
          }
          
          if (response && response.success) {
            // Clear form
            document.getElementById('contactName').value = '';
            document.getElementById('contactEmail').value = '';
            document.getElementById('contactMessage').value = '';
            
            // Reset dropdown to default
            const issueTypeDropdown = document.getElementById('contactIssueTypeDropdown');
            if (issueTypeDropdown) {
              const hiddenInput = document.getElementById('contactIssueType');
              const textSpan = issueTypeDropdown.querySelector('.custom-dropdown-text');
              const defaultOption = issueTypeDropdown.querySelector('.custom-dropdown-option[data-value="general"]');
              if (hiddenInput && textSpan && defaultOption) {
                hiddenInput.value = 'general';
                textSpan.textContent = defaultOption.textContent.trim();
                issueTypeDropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => opt.classList.remove('selected'));
                defaultOption.classList.add('selected');
              }
            }
            
            showNotification('Message sent successfully!', 'success');
          } else {
            // Fallback to mailto if API fails
            const recipient = 'charles@leveldesignagency.com';
            const mailtoSubject = encodeURIComponent(`[Nimbus Extension] ${subject}`);
            const mailtoBody = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nIssue Type: ${issueTypeText}\n\nMessage:\n${message}`);
            window.location.href = `mailto:${recipient}?subject=${mailtoSubject}&body=${mailtoBody}`;
            showNotification('Opening email client...', 'success');
          }
        });
      } catch (error) {
        console.error('Nimbus: Error sending contact form:', error);
        sendContactBtn.disabled = false;
        sendContactBtn.textContent = originalText;
        showNotification('Failed to send message. Please try again.', 'error');
      }
    });
  }

  // Search input handler
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (!query) {
      suggestions.classList.remove('show');
      currentSuggestions = [];
      return;
    }

    // Show suggestions immediately for short queries
    if (query.length >= 2) {
      console.log('Nimbus: Input event - query:', query);
      searchTimeout = setTimeout(() => {
        console.log('Nimbus: Calling searchWord with:', query);
        searchWord(query);
      }, 200);
    } else {
      suggestions.classList.remove('show');
    }
  });
  
  // Allow Enter key to search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        suggestions.classList.remove('show');
        executeSearch(query);
        searchInput.value = ''; // Clear search input
      }
    }
  });

  // Search icon button handler
  const searchIconBtn = document.getElementById('searchIconBtn');
  searchIconBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) {
      suggestions.classList.remove('show');
      executeSearch(query);
      searchInput.value = ''; // Clear search input
    }
  });

  // Execute search - handles both words and people
  async function executeSearch(query) {
    console.log('Nimbus: Executing search for:', query);
    
    // Check if it might be a person, organization, or entity
    // More flexible pattern: allows hyphens, apostrophes, multiple capitals
    const isLikelyEntity = /^[A-Z][A-Za-z'\-]+(\s+[A-Z][A-Za-z'\-]+)*(\s+(Inc|LLC|Ltd|Corp|Company|Corporation|Foundation|Institute|University|College|Group|Organization|Org))?$/i.test(query.trim()) && 
                          query.trim().split(/\s+/).length >= 1 && 
                          query.trim().split(/\s+/).length <= 6 &&
                          query.trim().length >= 2 &&
                          query.trim().length <= 80;
    
    if (isLikelyEntity) {
      // Try to fetch entity data (person or organization)
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'explain',
            word: query,
            context: ''
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          });
        });
        
        if (response && response.isPerson && response.personData) {
          displayPersonResult(query, response.personData);
          return;
        } else if (response && response.isOrganization && response.organizationData) {
          displayOrganizationResult(query, response.organizationData);
          return;
        }
      } catch (err) {
        console.log('Nimbus: Entity search failed, falling back to word search:', err);
      }
    }
    
    // Default to word search
    showWordDetails(query);
  }

  // Display person result in hub
  function displayPersonResult(searchTerm, personData) {
    console.log('Nimbus: displayPersonResult called with image:', personData?.image);
    currentView = 'person';
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Save to recent
    saveToRecent(searchTerm);
    loadRecent();
    
    // Build person card HTML
    const hasBack = navigationHistory.length > 1;
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal person-card">
        <div class="word-card-header">
          <div class="word-card-header-top">
            ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>` : ''}
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${personData.name || searchTerm}</span>
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="word-card-content person-content">
          ${personData.image ? `<div class="person-image-container">
            <img src="${personData.image}" alt="${personData.name}" class="person-image" onerror="console.error('Nimbus: Image failed to load:', this.src); this.parentElement.style.display='none';" onload="console.log('Nimbus: Person image loaded successfully:', this.src);">
          </div>` : ''}
          <div class="word-card-explanation person-bio">
            ${personData.bio || personData.summary || 'No biography available.'}
          </div>
          ${personData.birthDate || personData.occupation || personData.nationality ? `
          <div class="person-metadata">
            ${personData.birthDate ? `<div class="person-meta-item"><strong>Born:</strong> ${personData.birthDate}</div>` : ''}
            ${personData.occupation ? `<div class="person-meta-item"><strong>Occupation:</strong> ${personData.occupation}</div>` : ''}
            ${personData.nationality ? `<div class="person-meta-item"><strong>Nationality:</strong> ${personData.nationality}</div>` : ''}
          </div>
          ` : ''}
          ${personData.newsArticles && personData.newsArticles.length > 0 ? `
          <div class="person-news-section">
            <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
            <div class="person-news-list">
              ${personData.newsArticles.map((article, index) => `
                <div class="person-news-item" data-news-index="${index}">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
          ${personData.wikipediaUrl ? `
          <div class="person-wiki-link">
            <a href="${personData.wikipediaUrl}" target="_blank" rel="noopener noreferrer">Read more on Wikipedia</a>
          </div>
          ` : ''}
        </div>
      </div>
    `;
    
    // Add event listeners
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop();
          if (navigationHistory.length > 0) {
            showWordDetails(navigationHistory[navigationHistory.length - 1], false);
          } else {
            returnToHub();
          }
        });
      }
    }
    
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(personData.name || searchTerm);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 300);
        } catch (err) {
          console.error('Failed to copy', err);
        }
      });
    }
    
    // Add click handlers for news items
    if (personData.newsArticles && personData.newsArticles.length > 0) {
      wordOfDayDiv.querySelectorAll('.person-news-item').forEach((item, index) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const article = personData.newsArticles[index];
          if (article && article.link) {
            window.open(article.link, '_blank', 'noopener,noreferrer');
          }
        });
      });
    }
  }

  searchInput.addEventListener('focus', () => {
    if (currentSuggestions.length > 0) {
      suggestions.classList.add('show');
    }
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
      suggestions.classList.remove('show');
    }
  });

  // Navigation functions
  function returnToHub() {
    navigationHistory = [];
    currentView = 'hub';
    showHubView();
  }

  function showHubView() {
    // Show all sections
    document.querySelectorAll('.section').forEach(section => {
      section.style.display = 'block';
    });
    searchInput.value = '';
    loadFavorites();
    loadRecent();
    loadWordOfDay();
  }

  async function searchWord(query) {
    if (!query || query.length < 2) {
      console.log('Nimbus: searchWord - query too short, hiding');
      suggestions.classList.remove('show');
      return;
    }

    console.log('Nimbus: searchWord called with:', query);
    console.log('Nimbus: suggestions element exists:', !!suggestions);
    
    try {
      const queryLower = query.toLowerCase();
      
      // Get suggestions from recent and favorites (prioritized)
      const [favorites, recent] = await Promise.all([
        getStorage('favorites'),
        getStorage('recentSearches')
      ]);

      console.log('Nimbus: Favorites:', favorites, 'Recent:', recent);

      const localWords = [...(favorites || []), ...(recent || [])];
      const localMatches = localWords
        .filter(word => {
          const wordLower = word.toLowerCase();
          return wordLower.startsWith(queryLower) || wordLower.includes(queryLower);
        })
        .slice(0, 3); // Top 3 from local

      console.log('Nimbus: Local matches:', localMatches);

      // Get common word suggestions
      const commonSuggestions = await getWordSuggestions(query);
      console.log('Nimbus: Common suggestions:', commonSuggestions);
      
      // Combine: local matches first, then common words (avoid duplicates)
      const allSuggestions = [...localMatches];
      const seen = new Set(localMatches.map(w => w.toLowerCase()));
      
      for (const word of commonSuggestions) {
        if (!seen.has(word.toLowerCase()) && allSuggestions.length < 8) {
          allSuggestions.push(word);
          seen.add(word.toLowerCase());
        }
      }

      console.log('Nimbus: All suggestions:', allSuggestions);
      
      // Always show at least some suggestions from common words
      if (allSuggestions.length === 0) {
        console.log('Nimbus: No suggestions found, getting common words only');
        const commonOnly = await getWordSuggestions(query);
        console.log('Nimbus: Common words only:', commonOnly);
        showSuggestions(commonOnly);
      } else {
        showSuggestions(allSuggestions);
      }
    } catch (e) {
      console.error('Nimbus: Error searching', e);
      // Fallback to local only
      try {
        const [favorites, recent] = await Promise.all([
          getStorage('favorites'),
          getStorage('recentSearches')
        ]);
        const allWords = [...(favorites || []), ...(recent || [])];
        const filtered = allWords
          .filter(word => word.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 5);
        console.log('Nimbus: Fallback suggestions:', filtered);
        showSuggestions(filtered);
      } catch (e2) {
        console.error('Nimbus: Fallback also failed', e2);
        showSuggestions([]);
      }
    }
  }

  async function getWordSuggestions(query) {
    const queryLower = query.toLowerCase();
    const queryLength = queryLower.length;
    
    // Common English words that start with or contain the query
    // This is a curated list - in production, you might use a word list API
    const commonWords = [
      'ability', 'about', 'above', 'accept', 'account', 'achieve', 'across', 'action', 'active', 'activity',
      'actually', 'address', 'administration', 'admit', 'adult', 'affect', 'after', 'again', 'against', 'age',
      'agency', 'agent', 'ago', 'agree', 'agreement', 'ahead', 'air', 'all', 'allow', 'almost',
      'alone', 'along', 'already', 'also', 'although', 'always', 'American', 'among', 'amount', 'analysis',
      'and', 'animal', 'another', 'answer', 'any', 'anyone', 'anything', 'appear', 'apply', 'approach',
      'area', 'argue', 'arm', 'around', 'arrive', 'art', 'article', 'artist', 'as', 'ask',
      'assume', 'at', 'attack', 'attention', 'attorney', 'audience', 'author', 'authority', 'available', 'avoid',
      'away', 'baby', 'back', 'bad', 'bag', 'ball', 'bank', 'bar', 'base', 'be',
      'beat', 'beautiful', 'because', 'become', 'bed', 'before', 'begin', 'behavior', 'behind', 'believe',
      'benefit', 'best', 'better', 'between', 'beyond', 'big', 'bill', 'billion', 'bit', 'black',
      'blood', 'blue', 'board', 'body', 'book', 'born', 'both', 'box', 'boy', 'break',
      'bring', 'brother', 'budget', 'build', 'building', 'business', 'but', 'buy', 'by', 'call',
      'camera', 'campaign', 'can', 'cancer', 'candidate', 'capital', 'car', 'card', 'care', 'career',
      'carry', 'case', 'catch', 'cause', 'cell', 'center', 'central', 'century', 'certain', 'certainly',
      'chair', 'challenge', 'chance', 'change', 'character', 'charge', 'check', 'child', 'choice', 'choose',
      'church', 'citizen', 'city', 'civil', 'claim', 'class', 'clear', 'clearly', 'close', 'coach',
      'cold', 'collection', 'college', 'color', 'come', 'commercial', 'common', 'community', 'company', 'compare',
      'computer', 'concern', 'condition', 'conference', 'Congress', 'consider', 'consumer', 'contain', 'continue', 'control',
      'cost', 'could', 'country', 'couple', 'course', 'court', 'cover', 'create', 'crime', 'cultural',
      'culture', 'cup', 'current', 'customer', 'cut', 'dark', 'data', 'daughter', 'day', 'dead',
      'deal', 'death', 'debate', 'decade', 'decide', 'decision', 'deep', 'defense', 'degree', 'Democrat',
      'democratic', 'describe', 'design', 'despite', 'detail', 'determine', 'develop', 'development', 'die', 'difference',
      'different', 'difficult', 'dinner', 'direction', 'director', 'discover', 'discuss', 'discussion', 'disease', 'do',
      'doctor', 'dog', 'door', 'down', 'draw', 'dream', 'drive', 'drop', 'drug', 'during',
      'each', 'early', 'east', 'easy', 'eat', 'economic', 'economy', 'edge', 'education', 'effect',
      'effort', 'eight', 'either', 'election', 'else', 'employee', 'end', 'energy', 'enjoy', 'enough',
      'enter', 'entire', 'environment', 'environmental', 'especially', 'establish', 'even', 'evening', 'event', 'ever',
      'every', 'everybody', 'everyone', 'everything', 'evidence', 'exactly', 'example', 'executive', 'exist', 'expect',
      'experience', 'expert', 'explain', 'eye', 'face', 'fact', 'factor', 'fail', 'fall', 'family',
      'far', 'fast', 'father', 'fear', 'federal', 'feel', 'feeling', 'few', 'field', 'fight',
      'figure', 'fill', 'film', 'final', 'finally', 'find', 'fine', 'finger', 'finish', 'fire',
      'firm', 'first', 'fish', 'five', 'floor', 'fly', 'focus', 'follow', 'food', 'foot',
      'for', 'force', 'foreign', 'forget', 'form', 'former', 'forward', 'four', 'free', 'friend',
      'from', 'front', 'full', 'fund', 'future', 'game', 'garden', 'gas', 'general', 'generation',
      'get', 'girl', 'give', 'glass', 'go', 'goal', 'good', 'government', 'great', 'green',
      'ground', 'group', 'grow', 'growth', 'guess', 'gun', 'guy', 'hair', 'half', 'hand',
      'hang', 'happen', 'happy', 'hard', 'have', 'he', 'head', 'health', 'hear', 'heart',
      'heat', 'heavy', 'help', 'her', 'here', 'herself', 'high', 'him', 'himself', 'his',
      'history', 'hit', 'hold', 'home', 'hope', 'hospital', 'hot', 'hotel', 'hour', 'house',
      'how', 'however', 'huge', 'human', 'hundred', 'husband', 'I', 'idea', 'identify', 'if',
      'image', 'imagine', 'impact', 'important', 'improve', 'include', 'including', 'increase', 'indeed', 'indicate',
      'individual', 'industry', 'information', 'inside', 'instead', 'institution', 'interest', 'interesting', 'international', 'interview',
      'into', 'investment', 'involve', 'issue', 'it', 'item', 'its', 'itself', 'job', 'join',
      'just', 'keep', 'key', 'kid', 'kill', 'kind', 'kitchen', 'know', 'knowledge', 'land',
      'language', 'large', 'last', 'late', 'later', 'laugh', 'law', 'lawyer', 'lay', 'lead',
      'leader', 'learn', 'least', 'leave', 'left', 'leg', 'legal', 'less', 'let', 'letter',
      'level', 'lie', 'life', 'light', 'like', 'likely', 'line', 'list', 'listen', 'little',
      'live', 'local', 'long', 'look', 'lose', 'loss', 'lot', 'love', 'low', 'machine',
      'magazine', 'main', 'maintain', 'major', 'majority', 'make', 'man', 'manage', 'management', 'manager',
      'many', 'market', 'marriage', 'material', 'matter', 'may', 'maybe', 'me', 'mean', 'measure',
      'media', 'medical', 'meet', 'meeting', 'member', 'memory', 'mention', 'message', 'method', 'middle',
      'might', 'military', 'million', 'mind', 'minute', 'miss', 'mission', 'model', 'modern', 'moment',
      'money', 'month', 'more', 'morning', 'most', 'mother', 'mouth', 'move', 'movement', 'movie',
      'Mr', 'Mrs', 'much', 'music', 'must', 'my', 'myself', 'name', 'nation', 'national',
      'natural', 'nature', 'near', 'nearly', 'necessary', 'need', 'network', 'never', 'new', 'news',
      'newspaper', 'next', 'nice', 'night', 'no', 'none', 'nor', 'north', 'not', 'note',
      'nothing', 'notice', 'now', "n't", 'number', 'occur', 'of', 'off', 'offer', 'office',
      'officer', 'official', 'often', 'oh', 'oil', 'ok', 'old', 'on', 'once', 'one',
      'only', 'onto', 'open', 'operation', 'opportunity', 'option', 'or', 'order', 'organization', 'other',
      'others', 'our', 'out', 'outside', 'over', 'own', 'owner', 'page', 'pain', 'painting',
      'paper', 'parent', 'part', 'participant', 'particular', 'particularly', 'partner', 'party', 'pass', 'past',
      'patient', 'pattern', 'pay', 'peace', 'people', 'per', 'perform', 'performance', 'perhaps', 'period',
      'person', 'personal', 'phone', 'physical', 'pick', 'picture', 'piece', 'place', 'plan', 'plant',
      'play', 'player', 'PM', 'point', 'police', 'policy', 'political', 'politics', 'poor', 'popular',
      'population', 'position', 'positive', 'possible', 'power', 'practice', 'prepare', 'present', 'president', 'pressure',
      'pretty', 'prevent', 'price', 'private', 'probably', 'problem', 'process', 'produce', 'product', 'production',
      'professor', 'program', 'project', 'property', 'protect', 'prove', 'provide', 'public', 'pull', 'purpose',
      'push', 'put', 'quality', 'question', 'quickly', 'quite', 'race', 'radio', 'raise', 'range',
      'rate', 'rather', 'reach', 'read', 'ready', 'real', 'reality', 'realize', 'really', 'reason',
      'receive', 'recent', 'recently', 'recognize', 'record', 'red', 'reduce', 'reflect', 'region', 'relate',
      'relationship', 'religious', 'remain', 'remember', 'remove', 'report', 'represent', 'Republican', 'require', 'research',
      'resource', 'respond', 'response', 'responsibility', 'rest', 'result', 'return', 'reveal', 'rich', 'right',
      'rise', 'risk', 'road', 'rock', 'role', 'room', 'rule', 'run', 'safe', 'same',
      'save', 'say', 'scene', 'school', 'science', 'scientist', 'score', 'sea', 'season', 'seat',
      'second', 'section', 'security', 'see', 'seek', 'seem', 'sell', 'send', 'senior', 'sense',
      'series', 'serious', 'serve', 'service', 'set', 'seven', 'several', 'sex', 'sexual', 'shake',
      'shall', 'shape', 'share', 'she', 'shoot', 'short', 'shot', 'should', 'shoulder', 'show',
      'side', 'sign', 'significant', 'similar', 'simple', 'simply', 'since', 'sing', 'single', 'sister',
      'sit', 'site', 'situation', 'six', 'size', 'skill', 'skin', 'small', 'smile', 'so',
      'social', 'society', 'soldier', 'some', 'somebody', 'someone', 'something', 'sometimes', 'son', 'song',
      'soon', 'sort', 'sound', 'source', 'south', 'southern', 'space', 'speak', 'special', 'specific',
      'speech', 'spend', 'sport', 'spring', 'staff', 'stage', 'stand', 'standard', 'star', 'start',
      'state', 'statement', 'station', 'stay', 'step', 'still', 'stock', 'stop', 'store', 'story',
      'strategy', 'street', 'strong', 'structure', 'student', 'study', 'stuff', 'style', 'subject', 'success',
      'successful', 'such', 'suddenly', 'suffer', 'suggest', 'summer', 'support', 'sure', 'surface', 'system',
      'table', 'take', 'talk', 'task', 'tax', 'teach', 'teacher', 'team', 'technology', 'television',
      'tell', 'ten', 'tend', 'term', 'test', 'than', 'thank', 'that', 'the', 'their',
      'them', 'themselves', 'then', 'theory', 'there', 'these', 'they', 'thing', 'think', 'third',
      'this', 'those', 'though', 'thought', 'thousand', 'threat', 'three', 'through', 'throughout', 'throw',
      'thus', 'time', 'to', 'today', 'together', 'tonight', 'too', 'top', 'total', 'tough',
      'toward', 'town', 'trade', 'traditional', 'training', 'travel', 'treat', 'treatment', 'tree', 'trial',
      'trip', 'trouble', 'true', 'truth', 'try', 'turn', 'TV', 'two', 'type', 'under',
      'understand', 'unit', 'until', 'up', 'upon', 'us', 'use', 'usually', 'value', 'various',
      'very', 'victim', 'view', 'violence', 'visit', 'voice', 'vote', 'wait', 'walk', 'wall',
      'want', 'war', 'watch', 'water', 'way', 'we', 'weapon', 'wear', 'week', 'weight',
      'well', 'west', 'western', 'what', 'whatever', 'when', 'where', 'whether', 'which', 'while',
      'white', 'who', 'whole', 'whom', 'whose', 'why', 'wide', 'wife', 'will', 'win',
      'wind', 'window', 'wish', 'with', 'within', 'without', 'woman', 'wonder', 'word', 'work',
      'worker', 'world', 'worry', 'would', 'write', 'writer', 'wrong', 'yard', 'yeah', 'year',
      'yes', 'yet', 'you', 'young', 'your', 'yourself'
    ];

    // Filter words that start with the query (prioritize) or contain it
    const startsWith = commonWords
      .filter(word => word.toLowerCase().startsWith(queryLower))
      .slice(0, 5);
    
    // If we have enough "starts with" matches, return those
    if (startsWith.length >= 3) {
      return startsWith;
    }
    
    // Otherwise, add words that contain the query
    const contains = commonWords
      .filter(word => {
        const wordLower = word.toLowerCase();
        return !wordLower.startsWith(queryLower) && wordLower.includes(queryLower);
      })
      .slice(0, 5 - startsWith.length);
    
    return [...startsWith, ...contains];
  }

  function showSuggestions(words) {
    console.log('Nimbus: showSuggestions called with', words);
    console.log('Nimbus: suggestions element:', suggestions);
    
    if (!suggestions) {
      console.error('Nimbus: suggestions element not found!');
      return;
    }
    
    currentSuggestions = words;
    suggestions.innerHTML = '';

    if (words.length === 0) {
      suggestions.innerHTML = '<div class="suggestion-item" style="color: #94a3b8; font-style: italic;">No suggestions found</div>';
      suggestions.classList.add('show');
      console.log('Nimbus: Showing "no suggestions" message');
      return;
    }
    
    words.forEach((word, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      
      // Highlight matching part of the word
      const wordLower = word.toLowerCase();
      const queryLower = searchInput.value.trim().toLowerCase();
      const matchIndex = wordLower.indexOf(queryLower);
      
      if (matchIndex !== -1) {
        const before = word.substring(0, matchIndex);
        const match = word.substring(matchIndex, matchIndex + queryLower.length);
        const after = word.substring(matchIndex + queryLower.length);
        
        item.innerHTML = `${before}<strong>${match}</strong>${after}`;
      } else {
        item.textContent = word;
      }
      
      // Add visual indicator for favorites/recent (first few items)
      if (index < 3) {
        item.style.borderLeft = '3px solid #1e3a8a';
        item.style.paddingLeft = '13px';
      }
      
      item.addEventListener('click', () => {
        searchInput.value = word;
        suggestions.classList.remove('show');
        showWordDetails(word);
      });
      suggestions.appendChild(item);
    });

    suggestions.classList.add('show');
    console.log('Nimbus: Showing suggestions dropdown with', words.length, 'items');
    console.log('Nimbus: suggestions.classList:', suggestions.classList.toString());
    console.log('Nimbus: suggestions.style.display:', window.getComputedStyle(suggestions).display);
    console.log('Nimbus: suggestions.offsetHeight:', suggestions.offsetHeight);
    console.log('Nimbus: suggestions.offsetWidth:', suggestions.offsetWidth);
    
    // Force a reflow to ensure display change takes effect
    void suggestions.offsetHeight;
    
    // Double-check it's visible
    setTimeout(() => {
      const computed = window.getComputedStyle(suggestions);
      console.log('Nimbus: After timeout - display:', computed.display, 'visibility:', computed.visibility);
      if (computed.display === 'none') {
        console.error('Nimbus: Dropdown still hidden! Forcing display...');
        suggestions.style.display = 'block';
        suggestions.style.visibility = 'visible';
      }
    }, 10);
  }

  async function showWordDetails(word, pushToHistory = true) {
    // Add to navigation history if not already there
    if (pushToHistory && (navigationHistory.length === 0 || navigationHistory[navigationHistory.length - 1] !== word)) {
      navigationHistory.push(word);
    }

    // Save to recent
    await saveToRecent(word);
    loadRecent();

    // Get explanation
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
          type: 'explain', 
          word: word, 
          context: '',
          detailed: true
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      });

      if (resp && !resp.error) {
        // Check if word was not found
        if (resp.explanation && (
          resp.explanation.includes('not found') || 
          resp.explanation.includes('No definition found') ||
          resp.explanation.toLowerCase().includes('might be a proper noun')
        )) {
          // Show "did you mean" suggestions
          const suggestions = await getDidYouMeanSuggestions(word);
          showDidYouMean(word, suggestions);
        } else {
          displayWordDetails(word, resp);
        }
      } else if (resp && resp.error) {
        // Show "did you mean" for errors too
        const suggestions = await getDidYouMeanSuggestions(word);
        showDidYouMean(word, suggestions);
      }
    } catch (e) {
      console.error('Error getting word details', e);
      // Show "did you mean" on error
      const suggestions = await getDidYouMeanSuggestions(word);
      showDidYouMean(word, suggestions);
    }
  }

  async function displayWordDetails(word, data) {
    currentView = 'word';
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Get favorites to check if word is favorited
    const favorites = await getStorage('favorites') || [];
    const isFavorited = favorites.includes(word);
    
    // Get settings
    const settings = await new Promise(resolve => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
    const showPhonetic = settings.showPhonetic !== false;
    const showExamples = settings.showExamples !== false;
    
    // Extract synonyms
    let synonyms = [];
    if (data.synonyms !== undefined && data.synonyms !== null) {
      if (Array.isArray(data.synonyms)) {
        synonyms = data.synonyms.filter(s => s && typeof s === 'string' && s.trim());
      } else if (typeof data.synonyms === 'string') {
        synonyms = [data.synonyms.trim()].filter(s => s);
      }
    }
    
    // Build HTML matching modal layout exactly
    const hasBack = navigationHistory.length > 1;
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${word}</span>
                ${showPhonetic && data.pronunciation ? `<span class="word-card-phonetic">${data.pronunciation}</span>` : ''}
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy word">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
          ${hasBack ? `<button class="back-btn" id="wordCardBackBtn">← Back</button>` : ''}
        </div>
        <div class="word-card-explanation">${data.explanation || 'No explanation available.'}</div>
        ${showExamples && data.examples && data.examples.length > 0 ? `
          <div class="word-card-examples-container">
            <div class="word-card-examples-label">${translations[window.currentUILanguage || 'en']?.examplesLabel || 'Examples'}</div>
            <div class="word-card-examples-list">
              ${data.examples.map(ex => `<div class="word-card-example-item">${ex}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        ${synonyms.length > 0 ? `
          <div class="word-card-synonyms-container">
            <div class="word-card-synonyms-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
              </svg>
              ${translations[window.currentUILanguage || 'en']?.synonymsLabel || 'Synonyms'}
            </div>
            <div class="word-card-synonyms-scroll">
              ${synonyms.map(s => `<span class="word-card-synonym-tag" data-synonym="${s}">${s}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="word-card-actions">
          <button class="word-card-fav-btn-icon ${isFavorited ? 'favorited' : ''}" id="wordCardFavBtn" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button class="word-card-search-btn-icon" id="wordCardSearchBtn" title="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    // Event handlers
    if (hasBack) {
      document.getElementById('wordCardBackBtn').addEventListener('click', () => {
        navigationHistory.pop(); // Remove current
        const previousWord = navigationHistory[navigationHistory.length - 1];
        if (previousWord) {
          showWordDetails(previousWord, false); // Don't push to history
        } else {
          returnToHub();
        }
      });
    }
    
    document.getElementById('wordCardCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(word);
        const btn = document.getElementById('wordCardCopyBtn');
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
      } catch (e) {
        console.error('Failed to copy', e);
      }
    });
    
    document.getElementById('wordCardFavBtn').addEventListener('click', async () => {
      const favorites = await getStorage('favorites') || [];
      const index = favorites.indexOf(word);
      if (index > -1) {
        favorites.splice(index, 1);
      } else {
        favorites.push(word);
      }
      await setStorage({ favorites });
      const btn = document.getElementById('wordCardFavBtn');
      const isNowFavorited = favorites.includes(word);
      btn.classList.toggle('favorited', isNowFavorited);
      btn.querySelector('svg').setAttribute('fill', isNowFavorited ? 'currentColor' : 'none');
      loadFavorites();
    });
    
    document.getElementById('wordCardSearchBtn').addEventListener('click', () => {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(word)}`, '_blank');
    });
    
    // Make synonyms clickable
    wordOfDayDiv.querySelectorAll('.word-card-synonym-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        showWordDetails(tag.dataset.synonym);
      });
    });
  }

  async function getDidYouMeanSuggestions(word) {
    const wordLower = word.toLowerCase();
    const suggestions = [];
    
    // Get all words from favorites and recent
    const [favorites, recent] = await Promise.all([
      getStorage('favorites'),
      getStorage('recentSearches')
    ]);
    
    const allWords = [...(favorites || []), ...(recent || [])];
    
    // Simple Levenshtein-like matching (find words with similar length and characters)
    for (const candidate of allWords) {
      const candidateLower = candidate.toLowerCase();
      if (candidateLower === wordLower) continue;
      
      // Check if similar (same length ± 2, shares 70%+ characters)
      if (Math.abs(candidateLower.length - wordLower.length) <= 2) {
        let matches = 0;
        const minLen = Math.min(candidateLower.length, wordLower.length);
        for (let i = 0; i < minLen; i++) {
          if (candidateLower[i] === wordLower[i]) matches++;
        }
        if (matches / minLen >= 0.6) {
          suggestions.push(candidate);
        }
      }
    }
    
    // Also check common words
    const commonWords = await getWordSuggestions(wordLower.substring(0, Math.min(3, wordLower.length)));
    suggestions.push(...commonWords.filter(w => w.toLowerCase() !== wordLower));
    
    // Remove duplicates and limit to 5
    const unique = [...new Set(suggestions)];
    return unique.slice(0, 5);
  }

  function showDidYouMean(word, suggestions) {
    const hasBack = navigationHistory.length > 1;
    
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word" style="color: #dc2626;">${word}</span>
              </div>
            </div>
          </div>
          ${hasBack ? `<button class="back-btn" id="didYouMeanBackBtn">← Back</button>` : ''}
        </div>
        <div class="word-card-explanation" style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 18px; font-weight: 600; color: #64748b; margin-bottom: 12px;">
            Word not found
          </div>
          <div style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
            Did you mean one of these?
          </div>
          ${suggestions.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${suggestions.map(s => `
                <button class="suggestion-item" style="text-align: left; cursor: pointer; padding: 12px 16px; background: white; border: 1px solid #e2e8f0; border-radius: 8px; transition: all 0.2s;" data-word="${s}">
                  <span style="font-weight: 600; color: #1e3a8a;">${s}</span>
                </button>
              `).join('')}
            </div>
          ` : `
            <div style="font-size: 13px; color: #94a3b8;">
              No suggestions found. Try searching for a different word.
            </div>
          `}
        </div>
      </div>
    `;
    
    // Back button
    if (hasBack) {
      document.getElementById('didYouMeanBackBtn').addEventListener('click', () => {
        navigationHistory.pop();
        const previousWord = navigationHistory[navigationHistory.length - 1];
        if (previousWord) {
          showWordDetails(previousWord, false);
        } else {
          returnToHub();
        }
      });
    }
    
    // Suggestion clicks
    wordOfDayDiv.querySelectorAll('[data-word]').forEach(btn => {
      btn.addEventListener('click', () => {
        showWordDetails(btn.dataset.word);
      });
    });
  }
  
  function getPronunciation(word) {
    // Simple pronunciation guide
    return `/${word}/`;
  }

  async function loadFavorites() {
    try {
      const favorites = await getStorage('favorites') || [];
      
      if (favorites.length === 0) {
        const lang = window.currentUILanguage || 'en';
        const t = translations[lang] || translations.en;
        favoritesDiv.innerHTML = `<div class="empty-state">${t.noFavorites}</div>`;
        return;
      }

      favoritesDiv.innerHTML = favorites.map(word => `
        <div class="word-item" data-word="${word}">
          <span class="word">${word}</span>
          <button class="remove-btn" data-word="${word}">Remove</button>
        </div>
      `).join('');

      // Add click handlers - entire card is clickable
      favoritesDiv.querySelectorAll('.word-item').forEach(el => {
        el.addEventListener('click', (e) => {
          // Don't trigger if clicking the remove button
          if (!e.target.classList.contains('remove-btn')) {
            showWordDetails(el.dataset.word);
          }
        });
      });

      favoritesDiv.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeFavorite(btn.dataset.word);
          loadFavorites();
        });
      });
    } catch (e) {
      console.error('Error loading favorites', e);
      favoritesDiv.innerHTML = '<div class="empty-state">Error loading favorites</div>';
    }
  }

  let recentExpanded = false;
  let allRecentSearches = [];

  async function loadRecent() {
    try {
      let recent = await getStorage('recentSearches') || [];
      
      // Migrate old format (strings) to new format (objects with timestamp)
      if (recent.length > 0 && typeof recent[0] === 'string') {
        recent = recent.map(w => ({ word: w, timestamp: Date.now() }));
        await setStorage({ recentSearches: recent });
      }
      
      // Remove entries older than 3 days
      const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
      recent = recent.filter(item => {
        const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
        return timestamp > threeDaysAgo;
      });
      
      // Save cleaned list
      if (recent.length !== (await getStorage('recentSearches') || []).length) {
        await setStorage({ recentSearches: recent });
      }
      
      allRecentSearches = recent;
      
      if (recent.length === 0) {
        const lang = window.currentUILanguage || 'en';
        const t = translations[lang] || translations.en;
        recentDiv.innerHTML = `<div class="empty-state">${t.noRecentSearches}</div>`;
        return;
      }

      renderRecentSearches();
    } catch (e) {
      console.error('Error loading recent', e);
      recentDiv.innerHTML = '<div class="empty-state">Error loading recent searches</div>';
    }
  }

  function renderRecentSearches() {
    const lang = window.currentUILanguage || 'en';
    const t = translations[lang] || translations.en;
    
    if (recentExpanded) {
      // Show table view with all searches
      const tableHTML = `
        <div class="recent-table-container">
          <div class="recent-table-header">
            <span style="color: rgba(255, 255, 255, 0.8);">${t.allRecentSearches} (${allRecentSearches.length})</span>
            <button class="clear-all-btn" id="clearAllRecent">${t.clearAll}</button>
          </div>
          <div class="recent-table">
            ${allRecentSearches.map((item, index) => {
              const word = typeof item === 'string' ? item : item.word;
              const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
              const date = new Date(timestamp);
              const timeAgo = getTimeAgo(timestamp);
              return `
                <div class="recent-table-row">
                  <span class="recent-table-word" data-word="${word}">${word}</span>
                  <span class="recent-table-time">${timeAgo}</span>
                  <button class="recent-remove-btn" data-index="${index}" title="Remove">×</button>
                </div>
              `;
            }).join('')}
          </div>
          <button class="show-less-btn" id="collapseRecent">${t.showLess}</button>
        </div>
      `;
      recentDiv.innerHTML = tableHTML;
      
      // Add event handlers - entire row is clickable
      recentDiv.querySelectorAll('.recent-table-row').forEach(row => {
        const wordEl = row.querySelector('.recent-table-word');
        if (wordEl) {
          row.dataset.word = wordEl.dataset.word;
          row.style.cursor = 'pointer';
          row.addEventListener('click', (e) => {
            // Don't trigger if clicking the remove button
            if (!e.target.classList.contains('recent-remove-btn')) {
              showWordDetails(row.dataset.word);
            }
          });
        }
      });
      
      recentDiv.querySelectorAll('.recent-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const index = parseInt(btn.dataset.index);
          await removeRecentSearch(index);
        });
      });
      
      document.getElementById('clearAllRecent').addEventListener('click', async () => {
        if (confirm('Clear all recent searches?')) {
          await setStorage({ recentSearches: [] });
          allRecentSearches = [];
          recentExpanded = false;
          await loadRecent();
          showNotification('All recent searches cleared!', 'success');
        }
      });
      
      document.getElementById('collapseRecent').addEventListener('click', () => {
        recentExpanded = false;
        renderRecentSearches();
      });
    } else {
      // Show first 10 with Load More button - use same table style
      const first10 = allRecentSearches.slice(0, 10);
      const hasMore = allRecentSearches.length > 10;
      
      const listHTML = `
        <div class="recent-table-container">
          <div class="recent-table-header">
            <span style="color: rgba(255, 255, 255, 0.8);">${t.recentSearches}</span>
          </div>
          <div class="recent-table">
            ${first10.map((item, index) => {
              const word = typeof item === 'string' ? item : item.word;
              const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
              const timeAgo = getTimeAgo(timestamp);
              return `
                <div class="recent-table-row" data-word="${word}">
                  <span class="recent-table-word">${word}</span>
                  <span class="recent-table-time">${timeAgo}</span>
                </div>
              `;
            }).join('')}
          </div>
          ${hasMore ? `<button class="load-more-btn" id="loadMoreRecent">${t.loadMore} (${allRecentSearches.length - 10} ${t.more})</button>` : ''}
        </div>
      `;
      
      recentDiv.innerHTML = listHTML;
      
      // Add click handlers - entire row is clickable
      recentDiv.querySelectorAll('.recent-table-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          showWordDetails(row.dataset.word);
        });
      });
      
      if (hasMore) {
        document.getElementById('loadMoreRecent').addEventListener('click', () => {
          recentExpanded = true;
          renderRecentSearches();
        });
      }
    }
  }

  async function removeRecentSearch(index) {
    allRecentSearches.splice(index, 1);
    await setStorage({ recentSearches: allRecentSearches });
    renderRecentSearches();
  }

  function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  async function loadWordOfDay() {
    // Safety check
    if (!wordOfDayDiv) {
      console.error('Nimbus: wordOfDayDiv not found');
      return;
    }
    
    const currentLang = window.currentUILanguage || 'en';
    const loadingText = translations[currentLang]?.loadingWordOfDay || translations.en.loadingWordOfDay;
    wordOfDayDiv.innerHTML = `<div class="loading">${loadingText}</div>`;

    try {
      console.log('Nimbus: Starting to load word of day...');
      
      // Get a random word from a list or generate one
      const word = await getRandomWord();
      console.log('Nimbus: Word of day selected:', word);
      
      if (!word) {
        throw new Error('No word generated');
      }
      
      // Get detailed explanation with pronunciation and examples
      console.log('Nimbus: Fetching details for word:', word);
      const details = await getWordOfDayDetails(word);
      console.log('Nimbus: Details received:', details);
      
      // Check if wordOfDayDiv still exists (might have been removed)
      if (!wordOfDayDiv || !wordOfDayDiv.parentNode) {
        console.warn('Nimbus: wordOfDayDiv was removed, skipping display');
        return;
      }
      
      if (!details) {
        throw new Error('No details returned');
      }
      
      // Even if details has an error, still try to display it
      if (details && details.explanation) {
        console.log('Nimbus: Displaying word of day:', word, details);
        displayWordOfDay(word, details);
      } else {
        // If we have a word but no explanation, show the word with a fallback message
        console.warn('Nimbus: No explanation in details, showing fallback for word:', word);
        const currentLang = window.currentUILanguage || 'en';
        const t = translations[currentLang] || translations.en;
        displayWordOfDay(word, {
          explanation: currentLang === 'de' 
            ? `Definition für "${word}" wird geladen...`
            : `Definition for "${word}" is loading...`,
          synonyms: [],
          pronunciation: null,
          examples: []
        });
      }
    } catch (e) {
      console.error('Nimbus: Error loading word of day:', e);
      console.error('Nimbus: Error stack:', e.stack);
      
      // Check if wordOfDayDiv still exists before updating
      if (!wordOfDayDiv || !wordOfDayDiv.parentNode) {
        console.warn('Nimbus: wordOfDayDiv was removed, cannot show error');
        return;
      }
      
      const currentLang = window.currentUILanguage || 'en';
      const errorMsg = translations[currentLang]?.errorLoadingWordOfDay || 'Error loading word of the day.';
      wordOfDayDiv.innerHTML = `
        <div class="word-card-modal">
          <div class="word-card-header">
            <div class="word-of-day-title">${translations[currentLang]?.wordOfDay || 'Word of the Day'}</div>
          </div>
          <div class="empty-state">${errorMsg}</div>
        </div>
      `;
    }
  }

  async function getRandomWord() {
    try {
      // Get current language setting
      const settings = await new Promise(resolve => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
      const language = settings.dictionaryLanguage || 'en';
      
      // Language-specific word lists
      const wordLists = {
        en: [
          'serendipity', 'ephemeral', 'eloquent', 'resilient', 'mellifluous',
          'ubiquitous', 'perspicacious', 'luminous', 'effervescent', 'quintessential',
          'enigmatic', 'pragmatic', 'vivacious', 'tenacious', 'magnanimous',
          'sagacious', 'benevolent', 'audacious', 'fastidious', 'gregarious',
          'diligent', 'profound', 'ingenious', 'meticulous', 'eloquent',
          'ambitious', 'courageous', 'generous', 'optimistic', 'passionate'
        ],
        es: [
          'serendipidad', 'efímero', 'elocuente', 'resistente', 'melifluo',
          'ubicuo', 'perspicaz', 'luminoso', 'efervescente', 'quintaesencial',
          'enigmático', 'pragmático', 'vivaz', 'tenaz', 'magnánimo',
          'sagaz', 'benévolo', 'audaz', 'fastidioso', 'gregario',
          'diligente', 'profundo', 'ingenioso', 'meticuloso', 'ambicioso',
          'valiente', 'generoso', 'optimista', 'apasionado', 'sabiduría'
        ],
        fr: [
          'sérendipité', 'éphémère', 'éloquent', 'résilient', 'méliflu',
          'ubiquitaire', 'perspicace', 'lumineux', 'effervescent', 'quintessentiel',
          'énigmatique', 'pragmatique', 'vivace', 'tenace', 'magnanime',
          'sagace', 'bienveillant', 'audacieux', 'fastidieux', 'grégaire',
          'diligent', 'profond', 'ingénieux', 'méticuleux', 'ambitieux',
          'courageux', 'généreux', 'optimiste', 'passionné', 'sagesse'
        ],
        de: [
          'Serendipität', 'flüchtig', 'eloquent', 'widerstandsfähig', 'melodisch',
          'allgegenwärtig', 'scharfsinnig', 'leuchtend', 'sprudelnd', 'quintessentiell',
          'rätselhaft', 'pragmatisch', 'lebhaft', 'beharrlich', 'großmütig',
          'weise', 'wohlwollend', 'kühn', 'pingelig', 'gesellig',
          'fleißig', 'tiefgründig', 'genial', 'sorgfältig', 'ehrgeizig',
          'mutig', 'großzügig', 'optimistisch', 'leidenschaftlich', 'Weisheit'
        ],
        it: [
          'serendipità', 'effimero', 'eloquente', 'resiliente', 'melifluo',
          'ubiquo', 'perspicace', 'luminoso', 'effervescente', 'quintessenziale',
          'enigmatico', 'pragmatico', 'vivace', 'tenace', 'magnanimo',
          'saggio', 'benevolo', 'audace', 'fastidioso', 'gregario',
          'diligente', 'profondo', 'ingegnoso', 'meticoloso', 'ambizioso',
          'coraggioso', 'generoso', 'ottimista', 'appassionato', 'saggezza'
        ],
        pt: [
          'serendipidade', 'efêmero', 'eloquente', 'resiliente', 'melífluo',
          'ubíquo', 'perspicaz', 'luminoso', 'efervescente', 'quintessencial',
          'enigmático', 'pragmático', 'vivaz', 'tenaz', 'magnânimo',
          'sagaz', 'benevolente', 'audaz', 'fastidioso', 'gregário',
          'diligente', 'profundo', 'engenhoso', 'meticuloso', 'ambicioso',
          'corajoso', 'generoso', 'otimista', 'apaixonado', 'sabedoria'
        ],
        ru: [
          'серендипность', 'эфемерный', 'красноречивый', 'устойчивый', 'мелодичный',
          'вездесущий', 'проницательный', 'светящийся', 'игривый', 'квинтэссенция',
          'загадочный', 'прагматичный', 'живой', 'упорный', 'великодушный',
          'мудрый', 'доброжелательный', 'смелый', 'привередливый', 'общительный',
          'усердный', 'глубокий', 'гениальный', 'тщательный', 'амбициозный',
          'храбрый', 'щедрый', 'оптимистичный', 'страстный', 'мудрость'
        ],
        ja: [
          '偶然の幸運', 'はかない', '雄弁な', '回復力のある', '甘美な',
          '遍在する', '洞察力のある', '光る', '泡立つ', '典型',
          '謎めいた', '実用的な', '活気のある', '粘り強い', '寛大な',
          '賢明な', '親切な', '大胆な', '気難しい', '社交的な',
          '勤勉な', '深い', '独創的な', '細心の', '野心的な',
          '勇敢な', '寛大な', '楽観的な', '情熱的な', '知恵'
        ],
        zh: [
          '意外发现', '短暂的', '雄辩的', '有弹性的', '甜美的',
          '无处不在的', '敏锐的', '发光的', '冒泡的', '典型的',
          '神秘的', '实用的', '活泼的', '坚韧的', '宽宏大量的',
          '明智的', '仁慈的', '大胆的', '挑剔的', '合群的',
          '勤奋的', '深刻的', '有创造力的', '细致的', '有野心的',
          '勇敢的', '慷慨的', '乐观的', '热情的', '智慧'
        ],
        ko: [
          '우연한 발견', '덧없는', '웅변의', '회복력 있는', '달콤한',
          '어디에나 있는', '통찰력 있는', '빛나는', '거품나는', '전형적인',
          '수수께끼 같은', '실용적인', '활기찬', '끈질긴', '관대한',
          '현명한', '친절한', '대담한', '까다로운', '사교적인',
          '부지런한', '깊은', '독창적인', '꼼꼼한', '야심찬',
          '용감한', '관대한', '낙관적인', '열정적인', '지혜'
        ],
        ar: [
          'اكتشاف بالصدفة', 'عابر', 'بليغ', 'مرن', 'عذب',
          'موجود في كل مكان', 'ثاقب', 'مضيء', 'متدفق', 'مثالي',
          'غامض', 'عملي', 'حيوي', 'عنيد', 'كريم',
          'حكيم', 'طيب', 'جريء', 'صعب الإرضاء', 'اجتماعي',
          'مجتهد', 'عميق', 'مبتكر', 'دقيق', 'طموح',
          'شجاع', 'سخي', 'متفائل', 'شغوف', 'حكمة'
        ],
        hi: [
          'संयोग', 'अस्थायी', 'वाक्पटु', 'लचीला', 'मधुर',
          'सर्वव्यापी', 'तीक्ष्ण', 'चमकदार', 'उत्साही', 'सार',
          'रहस्यमय', 'व्यावहारिक', 'जीवंत', 'दृढ़', 'उदार',
          'बुद्धिमान', 'दयालु', 'साहसी', 'सावधान', 'सामाजिक',
          'परिश्रमी', 'गहरा', 'प्रतिभाशाली', 'सतर्क', 'महत्वाकांक्षी',
          'बहादुर', 'उदार', 'आशावादी', 'उत्साही', 'ज्ञान'
        ],
        nl: [
          'toevalstreffer', 'vluchtig', 'welsprekend', 'veerkrachtig', 'welluidend',
          'alomtegenwoordig', 'scherpzinnig', 'stralend', 'bruisend', 'quintessentieel',
          'raadselachtig', 'pragmatisch', 'levendig', 'volhardend', 'grootmoedig',
          'wijs', 'welwillend', 'gedurfd', 'kieskeurig', 'sociaal',
          'ijverig', 'diepgaand', 'geniaal', 'zorgvuldig', 'ambitieus',
          'moedig', 'vrijgevig', 'optimistisch', 'gepassioneerd', 'wijsheid'
        ],
        sv: [
          'lyckträff', 'flyktig', 'vältalig', 'motståndskraftig', 'melodisk',
          'allestädes närvarande', 'skarpsinnig', 'strålande', 'sprudlande', 'kvintessentiell',
          'gåtfull', 'pragmatisk', 'livlig', 'ihärdig', 'storsint',
          'vis', 'välvillig', 'djärv', 'petig', 'sällskaplig',
          'flitig', 'djup', 'genial', 'noggrann', 'ambitiös',
          'modig', 'generös', 'optimistisk', 'passionerad', 'visdom'
        ],
        pl: [
          'szczęśliwy traf', 'ulotny', 'wymowny', 'odporny', 'melodyjny',
          'wszechobecny', 'przenikliwy', 'świecący', 'musujący', 'kwintesencjalny',
          'tajemniczy', 'pragmatyczny', 'żywy', 'wytrwały', 'wielkoduszny',
          'mądry', 'życzliwy', 'śmiały', 'wybredny', 'towarzyski',
          'pilny', 'głęboki', 'genialny', 'staranny', 'ambitny',
          'odważny', 'hojny', 'optymistyczny', 'namiętny', 'mądrość'
        ]
      };
      
      // Get word list for current language, fallback to English
      const words = wordLists[language] || wordLists.en;
      
      // Check if we have a stored word of the day for today in this language
      const today = new Date().toISOString().slice(0, 10);
      const stored = await getStorage('wordOfDay');
      
      // Only use stored word if it's for today AND the same language
      if (stored && stored.date === today && stored.word && stored.language === language) {
        return stored.word;
      }
      
      // Pick random word from language-specific list
      const word = words[Math.floor(Math.random() * words.length)];
      
      // Store for today with language
      await setStorage({ wordOfDay: { date: today, word, language } });
      
      return word;
    } catch (e) {
      console.error('Error getting random word', e);
      // Fallback to a default word
      return 'serendipity';
    }
  }

  async function getWordOfDayDetails(word) {
    try {
      console.log('Nimbus: Getting word of day details for:', word);
      // Get explanation with detailed info
      const resp = await new Promise((resolve) => {
        try {
          if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            console.error('Nimbus: Extension context invalidated');
            resolve({ error: 'Extension context invalidated' });
            return;
          }
          
          // Set a timeout for the message
          const timeout = setTimeout(() => {
            console.error('Nimbus: Timeout waiting for background response');
            resolve({ error: 'Request timeout', explanation: `Definition für "${word}" wird geladen...` });
          }, 15000); // 15 second timeout
          
          chrome.runtime.sendMessage({ 
            type: 'explain', 
            word: word, 
            context: '',
            detailed: true
          }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.error('Nimbus: Error in sendMessage:', chrome.runtime.lastError.message);
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              console.log('Nimbus: Received response for word of day:', response);
              resolve(response || { error: 'No response' });
            }
          });
        } catch (e) {
          console.error('Nimbus: Exception in getWordOfDayDetails:', e);
          resolve({ error: e.message });
        }
      });

      console.log('Nimbus: Response from background:', resp);
      
      // Even if there's an error in the response, try to use what we have
      if (resp) {
        // Check if response has an error field but also has explanation
        if (resp.error && !resp.explanation) {
          console.warn('Nimbus: Response has error but no explanation:', resp.error);
          // Get current language for error message
          const settings = await new Promise(resolve => {
            chrome.storage.local.get(['settings'], (result) => {
              resolve(result.settings || {});
            });
          });
          const lang = settings.dictionaryLanguage || 'en';
          
          // Try to return a fallback that still shows the word
          const errorMessages = {
            'de': resp.error.includes('not found') || resp.error.includes('nicht gefunden')
              ? `"${word}" wurde im Wörterbuch nicht gefunden. Bitte versuchen Sie es später erneut.`
              : `Fehler beim Laden der Definition: ${resp.error}`,
            'en': resp.error.includes('not found')
              ? `"${word}" not found in dictionary. Please try again later.`
              : `Error loading definition: ${resp.error}`
          };
          
          return {
            explanation: errorMessages[lang] || errorMessages['en'],
            synonyms: resp.synonyms || [],
            pronunciation: resp.pronunciation || getPronunciation(word),
            examples: resp.examples || []
          };
        }
        
        // Return the response even if it has an error field, as long as it has explanation
        return {
          explanation: resp.explanation || resp.error || `Definition für "${word}"`,
          synonyms: resp.synonyms || [],
          pronunciation: resp.pronunciation || getPronunciation(word),
          examples: resp.examples || []
        };
      } else {
        // If no response at all, return fallback
        console.error('Nimbus: No response received');
        // Get current language for error message
        const settings = await new Promise(resolve => {
          chrome.storage.local.get(['settings'], (result) => {
            resolve(result.settings || {});
          });
        });
        const lang = settings.dictionaryLanguage || 'en';
        
        const errorMessages = {
          'de': `Konnte Definition für "${word}" nicht laden.`,
          'en': `Could not load definition for "${word}".`
        };
        
        return {
          explanation: errorMessages[lang] || errorMessages['en'],
          synonyms: [],
          pronunciation: getPronunciation(word),
          examples: []
        };
      }
    } catch (e) {
      console.error('Nimbus: Error getting word details:', e);
      // Fallback
      return {
        explanation: `Fehler beim Laden der Definition: ${e.message}`,
        synonyms: [],
        pronunciation: getPronunciation(word),
        examples: []
      };
    }
  }
  
  function getPronunciation(word) {
    // Simple pronunciation guide
    return `/${word}/`;
  }

  async function displayWordOfDay(word, details) {
    // Get favorites to check if word is favorited
    const favorites = await getStorage('favorites') || [];
    const isFavorited = favorites.includes(word);
    
    // Get settings
    const settings = await new Promise(resolve => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
    const showPhonetic = settings.showPhonetic !== false;
    const showExamples = settings.showExamples !== false;
    
    // Extract synonyms
    let synonyms = [];
    if (details.synonyms !== undefined && details.synonyms !== null) {
      if (Array.isArray(details.synonyms)) {
        synonyms = details.synonyms.filter(s => s && typeof s === 'string' && s.trim());
      } else if (typeof details.synonyms === 'string') {
        synonyms = [details.synonyms.trim()].filter(s => s);
      }
    }
    
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${word}</span>
                ${showPhonetic && details.pronunciation ? `<span class="word-card-phonetic">${details.pronunciation}</span>` : ''}
              </div>
              <button class="word-card-copy-btn" id="wotdCopyBtn" title="${translations[window.currentUILanguage || 'en']?.copyWord || 'Copy word'}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="word-of-day-title">${translations[window.currentUILanguage || 'en']?.wordOfDay || 'Word of the Day'}</div>
        </div>
        <div class="word-card-explanation">${details.explanation}</div>
        ${showExamples && details.examples && details.examples.length > 0 ? `
          <div class="word-card-examples-container">
            <div class="word-card-examples-label">${translations[window.currentUILanguage || 'en']?.examplesLabel || 'Examples'}</div>
            <div class="word-card-examples-list">
              ${details.examples.map(ex => `<div class="word-card-example-item">${ex}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        ${synonyms.length > 0 ? `
          <div class="word-card-synonyms-container">
            <div class="word-card-synonyms-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
              </svg>
              ${translations[window.currentUILanguage || 'en']?.synonymsLabel || 'Synonyms'}
            </div>
            <div class="word-card-synonyms-scroll">
              ${synonyms.map(s => `<span class="word-card-synonym-tag" data-synonym="${s}">${s}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="word-card-actions">
          <button class="word-card-fav-btn-icon ${isFavorited ? 'favorited' : ''}" id="wotdFavBtn" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button class="word-card-search-btn-icon" id="wotdSearchBtn" title="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    // Event handlers
    document.getElementById('wotdCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(word);
        const btn = document.getElementById('wotdCopyBtn');
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
      } catch (e) {
        console.error('Failed to copy', e);
      }
    });
    
    document.getElementById('wotdFavBtn').addEventListener('click', async () => {
      const favorites = await getStorage('favorites') || [];
      const index = favorites.indexOf(word);
      if (index > -1) {
        favorites.splice(index, 1);
      } else {
        favorites.push(word);
      }
      await setStorage({ favorites });
      const btn = document.getElementById('wotdFavBtn');
      const isNowFavorited = favorites.includes(word);
      btn.classList.toggle('favorited', isNowFavorited);
      btn.querySelector('svg').setAttribute('fill', isNowFavorited ? 'currentColor' : 'none');
      loadFavorites();
    });
    
    document.getElementById('wotdSearchBtn').addEventListener('click', () => {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(word)}`, '_blank');
    });
    
    // Make synonyms clickable
    wordOfDayDiv.querySelectorAll('.word-card-synonym-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        showWordDetails(tag.dataset.synonym);
      });
    });
  }

  // Helper functions
  function getStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (res) => {
        resolve(res[key]);
      });
    });
  }

  function setStorage(data) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve();
          return;
        }
        chrome.storage.local.set(data, () => {
          if (chrome.runtime.lastError) {
            console.error('Storage error', chrome.runtime.lastError);
          }
          resolve();
        });
      } catch (e) {
        console.error('Storage set error', e);
        resolve();
      }
    });
  }

  async function removeFavorite(word) {
    const favorites = await getStorage('favorites') || [];
    const filtered = favorites.filter(w => w !== word);
    await setStorage({ favorites: filtered });
  }

  async function saveToRecent(word) {
    // Check if we're in incognito mode - don't save if so
    try {
      if (chrome && chrome.extension && chrome.extension.inIncognitoContext) {
        console.log('CursorIQ: Incognito mode detected, not saving to recent');
        return;
      }
    } catch (e) {
      // Extension context might not be available in popup
    }
    
    const recent = await getStorage('recentSearches') || [];
    
    // Migrate old format (strings) to new format (objects with timestamp)
    let recentList = recent;
    if (recent.length > 0 && typeof recent[0] === 'string') {
      recentList = recent.map(w => ({ word: w, timestamp: Date.now() }));
    }
    
    // Remove if already exists
    const filtered = recentList.filter(item => {
      const itemWord = typeof item === 'string' ? item : item.word;
      return itemWord !== word;
    });
    
    // Add to front with timestamp
    filtered.unshift({ word: word, timestamp: Date.now() });
    
    // Remove entries older than 3 days
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const cleaned = filtered.filter(item => {
      const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
      return timestamp > threeDaysAgo;
    });
    
    await setStorage({ recentSearches: cleaned.slice(0, 50) });
  }

  // Make loadWordOfDay available globally for onclick
  window.loadWordOfDay = loadWordOfDay;

})();

