/*!
 * Color mode toggler for Bootstrap's docs (https://getbootstrap.com/)
 * Copyright 2011-2025 The Bootstrap Authors
 * Licensed under the Creative Commons Attribution 3.0 Unported License.
 */

'use strict';

const getStoredTheme = () => localStorage.getItem('theme');
const setStoredTheme = (theme) => localStorage.setItem('theme', theme);

const getPreferredTheme = () => {
  const storedTheme = getStoredTheme();
  if (storedTheme) {
    return storedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const setTheme = (theme) => {
  if (theme === 'auto') {
    document.documentElement.setAttribute('data-bs-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-bs-theme', theme);
  }
};

setTheme(getPreferredTheme());

const showActiveTheme = (theme, focus = false) => {
  const themeSwitcher = document.querySelector('#bd-theme');

  if (!themeSwitcher) {
    return;
  }

  const themeSwitcherText = document.querySelector('#bd-theme-text');
  const activeThemeIcon = document.querySelector('.theme-icon-active use');
  const btnToActive = document.querySelector(`[data-bs-theme-value="${theme}"]`);
  const svgOfActiveBtn = btnToActive.querySelector('svg use').getAttribute('href');

  document.querySelectorAll('[data-bs-theme-value]').forEach((element) => {
    element.classList.remove('active');
    element.setAttribute('aria-pressed', 'false');
  });

  btnToActive.classList.add('active');
  btnToActive.setAttribute('aria-pressed', 'true');
  activeThemeIcon.setAttribute('href', svgOfActiveBtn);
  const themeSwitcherLabel = `${themeSwitcherText.textContent} (${btnToActive.dataset.bsThemeValue})`;
  themeSwitcher.setAttribute('aria-label', themeSwitcherLabel);

  if (focus) {
    themeSwitcher.focus();
  }
};

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const storedTheme = getStoredTheme();
  if (storedTheme !== 'light' && storedTheme !== 'dark') {
    setTheme(getPreferredTheme());
  }
});

$(function () {
  $('#header-placeholder').load('/partials/header.html', function () {
    showActiveTheme(getPreferredTheme());

    document.querySelectorAll('[data-bs-theme-value]').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const theme = toggle.getAttribute('data-bs-theme-value');
        setStoredTheme(theme);
        setTheme(theme);
        showActiveTheme(theme, true);
      });
    });

    const themeSwitcherBtn = document.querySelector('#bd-theme');
    const handleResize = () => {
      if (window.innerWidth < 992) {
        themeSwitcherBtn.classList.remove('btn-sm');
      } else {
        themeSwitcherBtn.classList.add('btn-sm');
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    // Now that the header is loaded, check auth status and populate buttons
    $.ajax({
      url: '/api/auth/me',
      method: 'GET',
      success: function (data) {
        const headerButtons = $('#header-buttons');
        const flyInMenuItems = $('#fly-in-menu-items');
        headerButtons.empty();
        flyInMenuItems.empty();

        if (data.sitemap && data.sitemap.length > 0) {
          data.sitemap.forEach(function (item) {
            const button = $(`<a href="${item.url}" class="btn btn-sm ${item.type}">${item.text}</a>`);
            if (item.url === '/logout') {
              button.on('click', function (e) {
                e.preventDefault();
                $.ajax({
                  url: '/api/auth/logout',
                  method: 'GET',
                  success: function () {
                    window.location.href = '/';
                  },
                });
              });
            }
            headerButtons.append(button.clone(true));
            flyInMenuItems.append(button);
          });
          headerButtons.addClass('d-lg-flex');
        }
      },
      error: function () {
        const headerButtons = $('#header-buttons');
        const flyInMenuItems = $('#fly-in-menu-items');
        headerButtons.empty();
        flyInMenuItems.empty();
        headerButtons.append('<a href="/login" class="btn btn-sm btn-primary">Login</a>');
        headerButtons.addClass('d-lg-flex');
        flyInMenuItems.append('<a href="/login" class="btn btn-sm btn-primary">Login</a>');
      },
    });

    $(document).on('click', '#burger-menu', function () {
      $('#fly-in-menu').toggleClass('show');
    });

    $(document).on('click', '#close-menu', function () {
      $('#fly-in-menu').removeClass('show');
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape' && $('#fly-in-menu').hasClass('show')) {
        $('#close-menu').trigger('click');
      }
    });

    $(document).on('click', function (e) {
      const flyInMenu = $('#fly-in-menu');
      const burgerMenu = $('#burger-menu');
      if (flyInMenu.hasClass('show') && !flyInMenu.is(e.target) && flyInMenu.has(e.target).length === 0 && !burgerMenu.is(e.target) && burgerMenu.has(e.target).length === 0) {
        flyInMenu.removeClass('show');
      }
    });
  });
  $('#footer-placeholder').load('/partials/footer.html');
});
