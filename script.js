document.addEventListener('DOMContentLoaded', () => {
  
  /* ==========================================================================
     Language Selector Logic
     ========================================================================== */
  const langBtn = document.getElementById('lang-btn');
  const htmlElement = document.documentElement;

  // Retrieve saved language from localStorage, default to German ('de')
  const savedLang = localStorage.getItem('cozy-lang') || 'de';
  htmlElement.setAttribute('lang', savedLang);

  langBtn.addEventListener('click', () => {
    const currentLang = htmlElement.getAttribute('lang');
    const newLang = currentLang === 'de' ? 'en' : 'de';
    
    htmlElement.setAttribute('lang', newLang);
    localStorage.setItem('cozy-lang', newLang);
  });

  /* ==========================================================================
     Countdown Timer Logic
     ========================================================================== */
  // Target date: Jan 4, 2027 (Local time)
  const targetDate = new Date('2027-01-04T00:00:00').getTime();

  const daysVal = document.getElementById('timer-days');
  const hoursVal = document.getElementById('timer-hours');
  const minutesVal = document.getElementById('timer-minutes');
  const secondsVal = document.getElementById('timer-seconds');

  function updateCountdown() {
    const now = new Date().getTime();
    const distance = targetDate - now;

    // Time calculations
    let days = Math.floor(distance / (1000 * 60 * 60 * 24));
    let hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    let minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    let seconds = Math.floor((distance % (1000 * 60)) / 1000);

    // If countdown is finished
    if (distance < 0) {
      days = 0;
      hours = 0;
      minutes = 0;
      seconds = 0;
      clearInterval(timerInterval);
    }

    // Format numbers with leading zeros
    daysVal.textContent = String(days).padStart(2, '0');
    hoursVal.textContent = String(hours).padStart(2, '0');
    minutesVal.textContent = String(minutes).padStart(2, '0');
    secondsVal.textContent = String(seconds).padStart(2, '0');
  }

  // Initial call and set interval
  updateCountdown();
  const timerInterval = setInterval(updateCountdown, 1000);

  /* ==========================================================================
     Dynamic Lantern Parallax (Mouse Move Effect)
     ========================================================================== */
  const root = document.documentElement;
  let running = false;

  document.addEventListener('mousemove', (e) => {
    if (!running) {
      window.requestAnimationFrame(() => {
        // Calculate offsets relative to center of screen
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        // Max translation offset: 12px
        const maxOffset = 12;
        const moveX = ((e.clientX - centerX) / centerX) * maxOffset;
        const moveY = ((e.clientY - centerY) / centerY) * maxOffset;

        // Set custom variables for CSS translations
        root.style.setProperty('--mx', `${moveX.toFixed(2)}px`);
        root.style.setProperty('--my', `${moveY.toFixed(2)}px`);
        
        running = false;
      });
      running = true;
    }
  });

  /* ==========================================================================
     Copyright Year
     ========================================================================== */
  const yearElement = document.getElementById('current-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  /* ==========================================================================
     Newsletter Signup Logic
     ========================================================================== */
  const newsletterForm = document.getElementById('newsletter-form');
  const newsletterStatus = document.getElementById('newsletter-status');
  const newsletterButton = document.getElementById('mc-embedded-subscribe');

  const messages = {
    de: {
      pending: 'Fast geschafft. Bitte bestaetige die Anmeldung in deinem E-Mail-Postfach.',
      subscribed: 'Du bist bereits angemeldet. Schoen, dass du dabei bist.',
      invalidEmail: 'Bitte gib eine gueltige E-Mail-Adresse ein.',
      turnstile: 'Bitte bestaetige kurz, dass du ein Mensch bist.',
      rateLimited: 'Zu viele Versuche. Bitte probiere es in ein paar Minuten erneut.',
      error: 'Das hat leider nicht geklappt. Bitte versuche es gleich noch einmal.',
      loading: 'Wird angemeldet...'
    },
    en: {
      pending: 'Almost there. Please confirm the signup in your email inbox.',
      subscribed: 'You are already subscribed. Lovely to have you here.',
      invalidEmail: 'Please enter a valid email address.',
      turnstile: 'Please confirm that you are human.',
      rateLimited: 'Too many attempts. Please try again in a few minutes.',
      error: 'That did not work. Please try again in a moment.',
      loading: 'Signing up...'
    }
  };

  function getActiveLang() {
    return htmlElement.getAttribute('lang') === 'en' ? 'en' : 'de';
  }

  function setNewsletterStatus(type, key) {
    if (!newsletterStatus) return;

    const lang = getActiveLang();
    newsletterStatus.textContent = messages[lang][key] || messages[lang].error;
    newsletterStatus.dataset.status = type;
  }

  function resetTurnstile() {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
      window.turnstile.reset();
    }
  }

  if (newsletterForm && newsletterButton) {
    newsletterForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(newsletterForm);
      const email = String(formData.get('email') || '').trim();
      const turnstileToken = String(formData.get('cf-turnstile-response') || '');

      if (!newsletterForm.checkValidity() || !email) {
        setNewsletterStatus('error', 'invalidEmail');
        return;
      }

      if (!turnstileToken) {
        setNewsletterStatus('error', 'turnstile');
        return;
      }

      newsletterButton.disabled = true;
      newsletterButton.setAttribute('aria-busy', 'true');
      setNewsletterStatus('loading', 'loading');

      try {
        const response = await fetch(newsletterForm.action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            email,
            language: getActiveLang(),
            turnstileToken
          })
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok) {
          newsletterForm.reset();
          resetTurnstile();
          setNewsletterStatus('success', result.code === 'already_subscribed' ? 'subscribed' : 'pending');
          return;
        }

        if (response.status === 429) {
          setNewsletterStatus('error', 'rateLimited');
          resetTurnstile();
          return;
        }

        setNewsletterStatus('error', result.code === 'turnstile_failed' ? 'turnstile' : 'error');
        resetTurnstile();
      } catch (error) {
        setNewsletterStatus('error', 'error');
        resetTurnstile();
      } finally {
        newsletterButton.disabled = false;
        newsletterButton.removeAttribute('aria-busy');
      }
    });
  }

});
