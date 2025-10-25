/* global bootstrap */
$(document).ready(function () {
  let currentUser = null;

  // Check if the user is authenticated
  $.ajax({
    url: '/api/auth/me',
    method: 'GET',
    success: function (data) {
      if (!data.isAuthenticated) {
        return;
      }
      // User is authenticated, proceed with loading dashboard
      currentUser = data;
      loadDashboard();
    },
    error: function () {
      // User is not authenticated
    },
  });

  function loadDashboard() {
    $('[data-bs-toggle="tooltip"]').tooltip();
    $.ajax({
      url: '/api/config',
      method: 'GET',
      success: function (config) {
        if (currentUser.roles && currentUser.roles.includes('administrator') && config.setupMode === 'true') {
          $('#setup-alert').show();
        }
        if (config.maxApiKeysPerUser) {
          $('#max-api-keys').attr('max', config.maxApiKeysPerUser);
        }
      },
    });

    if (currentUser.roles.includes('administrator')) {
      $('#admin-section').show();
    }
    $('#reporting-email').val(currentUser.reporting_email);
    $('#reporting-email').attr('placeholder', currentUser.username);
    $('#reporting-weekday').val(currentUser.reporting_weekday);
    $('#is-dev').prop('checked', currentUser.is_dev);
    loadUserData();
  }

  function loadUserData() {
    loadApiKeys();
    loadWebsites();

    $('#create-api-key-form').on('submit', function (e) {
      e.preventDefault();
      $.ajax({
        url: '/api/api-keys',
        method: 'POST',
        success: function () {
          loadApiKeys();
        },
        error: function (err) {
          alert(err.responseText);
        },
      });
    });

    $('#change-password-form').on('submit', function (e) {
      e.preventDefault();
      const newPassword = $('#new-password').val();
      const reEnterPassword = $('#re-enter-password').val();

      if (newPassword !== reEnterPassword) {
        alert('Passwords do not match.');
        return;
      }

      $.ajax({
        url: '/api/users/password',
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ newPassword }),
        success: function () {
          alert('Password changed successfully.');
          $('#new-password').val('');
          $('#re-enter-password').val('');
        },
        error: function (err) {
          $('#error-message').text(err.responseText).show();
        },
      });
    });

    $('#reporting-form').on('submit', function (e) {
      e.preventDefault();
      const reporting_weekday = $('#reporting-weekday').val();
      const reporting_email = $('#reporting-email').val();
      const is_dev = $('#is-dev').is(':checked');
      $('#reporting-spinner').show();
      $.ajax({
        url: '/api/users/me',
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ reporting_weekday, is_dev, reporting_email }),
        success: function () {
          alert('Reporting settings saved.');
          $('#send-report-now').prop('disabled', false);
        },
        error: function (err) {
          alert(err.responseText);
        },
        complete: function () {
          $('#reporting-spinner').fadeOut();
        },
      });
    });

    $('#reporting-email, #reporting-weekday').on('input change', function () {
      $('#send-report-now').prop('disabled', true);
    });

    $('#send-report-now').on('click', function () {
      $('#reporting-spinner').show();
      $.ajax({
        url: '/api/reports/summary-email',
        method: 'POST',
        success: function () {
          alert('Report sent successfully.');
        },
        error: function (err) {
          alert(err.responseText);
        },
        complete: function () {
          $('#reporting-spinner').fadeOut();
        },
      });
    });
  }

  function loadApiKeys() {
    $.when(
      $.ajax({
        url: '/api/api-keys',
        method: 'GET',
      }),
      $.ajax({
        url: '/api/config',
        method: 'GET',
      })
    ).done(function (apiKeysResponse) {
      const keys = apiKeysResponse[0];

      const keysList = $('#api-keys-list');
      keysList.empty();
      if (keys.length === 0) {
        keysList.append('<div class="alert alert-info">No API keys configured</div>');
      } else {
        keys.forEach(function (key) {
          keysList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <i class="bi bi-clipboard copy-icon me-2" data-key="${key.api_key}" title="Copy to clipboard"></i>
                                <span class="api-key-text" data-key="${key.api_key}" title="Click to copy">${key.api_key}</span>
                            </div>
                            <button class="btn btn-sm btn-danger" data-key="${key.api_key}"><i class="bi bi-trash"></i></button>
                        </li>
                    `);
        });
      }
      // Initialize tooltips
      $('#api-keys-list [title]').tooltip();

      if (keys.length > 0) {
        updateCodeExamples();
        $('#api-key-usage-section').fadeIn();
      } else {
        $('#api-key-usage-section').hide();
      }
    });
  }

  $('#api-keys-list').on('click', '.copy-icon, .api-key-text', function () {
    const key = $(this).data('key');
    navigator.clipboard.writeText(key).then(() => {
      const icon = $(this).closest('li').find('.copy-icon');
      const originalTitle = icon.attr('data-bs-original-title');
      icon.attr('data-bs-original-title', 'Copied!').tooltip('show');
      setTimeout(() => {
        icon.attr('data-bs-original-title', originalTitle).tooltip('hide');
      }, 2000);
    });
  });

  $('#api-keys-list').on('click', '.btn-danger', function () {
    const key = $(this).data('key');
    $.ajax({
      url: `/api/api-keys/${key}`,
      method: 'DELETE',
      success: function () {
        loadApiKeys();
      },
    });
  });

  $('input[name="tool-switcher"]').on('change', function () {
    updateCodeExamples();
  });

  function updateCodeExamples() {
    const selectedTool = $('input[name="tool-switcher"]:checked').attr('id');
    const firstKey = $('#api-keys-list .api-key-text').first().data('key');
    if (!firstKey) return;

    $.ajax({
      url: '/api/config',
      method: 'GET',
      success: function (config) {
        const baseUrl = config.baseUrl;
        const slug = config.exampleWpComponentSlug;

        if (selectedTool === 'curl-btn') {
          const curlCommand = `curl \\\n  -H "X-API-Key: ${firstKey}" \\\n  ${baseUrl}/api/components/wordpress-plugin/${slug} | jq .`;
          $('#curl-example').text(curlCommand);

          const curlSearchCommand = `curl \\\n  -H "X-API-Key: ${firstKey}" \\\n  '${baseUrl}/api/components/search?query=slider%20revolution' | jq .`;
          $('#curl-search-example').text(curlSearchCommand);
        } else if (selectedTool === 'httpie-btn') {
          const httpieCommand = `http \\\n  ${baseUrl}/api/components/wordpress-plugin/${slug} \\\n  X-API-Key:${firstKey} | jq .`;
          $('#curl-example').text(httpieCommand);

          const httpieSearchCommand = `http \\\n  ${baseUrl}/api/components/search \\\n  query=='slider revolution' \\\n  X-API-Key:${firstKey} | jq .`;
          $('#curl-search-example').text(httpieSearchCommand);
        }
      },
    });
  }

  $('.code-container').on('click', '.copy-code-btn', function () {
    const textToCopy = $(this).siblings('pre').find('code').text();
    navigator.clipboard.writeText(textToCopy).then(() => {
      const icon = $(this);
      const originalTitle = icon.attr('data-bs-original-title');
      icon.attr('data-bs-original-title', 'Copied!').tooltip('show');
      setTimeout(() => {
        icon.attr('data-bs-original-title', originalTitle).tooltip('hide');
      }, 2000);
    });
  });

  let limit = 5;
  let currentPage = 1;
  let currentSearch = '';

  $('#website-search-form').on('submit', function (e) {
    e.preventDefault();
    const searchTerm = $('#website-search-input').val();
    loadWebsites(1, searchTerm);
  });

  $('#website-search-input').on('input', function () {
    if ($(this).val() === '') {
      loadWebsites(1, '');
    }
  });

  $('#vulnerable-toggle').on('change', function () {
    loadWebsites(1, currentSearch);
  });

  function loadWebsites(page = 1, search = '') {
    if (currentUser && currentUser.defaultPageSize) {
      limit = currentUser.defaultPageSize;
    }
    currentPage = page;
    currentSearch = search;
    $('#website-list-spinner').show();

    const onlyVulnerable = $('#vulnerable-toggle').is(':checked');
    let url = `/api/websites?page=${page}&limit=${limit}`;
    if (search) {
      url += `&q=${encodeURIComponent(search)}`;
    }
    if (onlyVulnerable) {
      url += '&only_vulnerable=1';
    }

    $.ajax({
      url,
      method: 'GET',
      success: function (data) {
        $('#website-list-spinner').fadeOut();
        const websitesList = $('#websites-list');
        websitesList.empty();
        if (data.websites.length === 0) {
          websitesList.append('<div class="alert alert-info">You aren\'t monitoring any websites yet.</div>');
        } else {
          data.websites.forEach(function (website) {
            const hasVulnerabilities = website.vulnerability_count > 0;

            let iconHtml;
            if (hasVulnerabilities) {
              const vulnerabilityCount = website.vulnerability_count > 9 ? '9+' : website.vulnerability_count;
              iconHtml = `
            <span class="position-relative">
                <i class="bi bi-globe text-danger me-2 vulnerability-icon"></i>
                <span class="position-absolute top-0 start-0 translate-middle badge rounded-pill bg-danger">${vulnerabilityCount}</span>
            </span>
        `;
            } else {
              iconHtml = `<i class="bi bi-globe me-2 vulnerability-icon"></i>`;
            }

            const devBadge = website.is_dev ? '<span class="badge bg-secondary ms-2">DEV</span>' : '';

            const websiteItem = $(`
                        <li class="list-group-item ${hasVulnerabilities ? 'list-group-item-danger' : ''}" data-domain="${website.domain}">
                            <div class="d-flex justify-content-between align-items-center">
                                <div class="d-flex align-items-center website-info">
                                    ${iconHtml}
                                    <div>
                                        <strong>${website.title || website.domain}${devBadge}</strong>
                                        <br>
                                        <small><a href="${website.url}" target="_blank" class="text-decoration-none">${website.domain} <i class="bi bi-box-arrow-up-right"></i></a></small>
                                    </div>
                                </div>
                                <div class="d-flex align-items-center">
                                    <button class="btn btn-sm btn-primary me-2 view-components-btn">Info...</button>
                                    <button class="btn btn-sm btn-danger delete-website-btn"><i class="bi bi-trash"></i></button>
                                </div>
                            </div>
                        </li>
                    `);
            websiteItem.data('website', website);
            websitesList.append(websiteItem);
          });
        }
        renderWebsitePagination(data.total, data.page, data.limit);
        $('#websites-list [title]').tooltip();
      },
    });
  }

  function renderWebsitePagination(total, page, limit) {
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      if (currentSearch) {
        $('#websites-list').html('<div class="alert alert-info">No websites found matching your search.</div>');
      } else {
        $('#websites-list').html('<div class="alert alert-info">You aren\'t monitoring any websites yet.</div>');
      }
    }

    if (totalPages > 0) {
      $('#website-page-count').text(`Page ${page} of ${totalPages}`).show();
    } else {
      $('#website-page-count').hide();
    }

    $('#website-toolbar').show();

    const noPages = totalPages === 0;
    $('#first-page').toggleClass('disabled', page === 1 || noPages);
    $('#prev-page').toggleClass('disabled', page === 1 || noPages);
    $('#next-page').toggleClass('disabled', page === totalPages || noPages);
    $('#last-page').toggleClass('disabled', page === totalPages || noPages);

    $('#first-page')
      .off('click')
      .on('click', () => loadWebsites(1, currentSearch));
    $('#prev-page')
      .off('click')
      .on('click', () => loadWebsites(page - 1, currentSearch));
    $('#next-page')
      .off('click')
      .on('click', () => loadWebsites(page + 1, currentSearch));
    $('#last-page')
      .off('click')
      .on('click', () => loadWebsites(totalPages, currentSearch));
    $('#reload-page')
      .off('click')
      .on('click', () => loadWebsites(currentPage, currentSearch))
      .tooltip();
  }

  $('#websites-list').on('click', '.delete-website-btn', function () {
    const websiteDomain = $(this).closest('li').data('domain');
    if (confirm('Are you sure you want to delete this website?')) {
      $.ajax({
        url: `/api/websites/${websiteDomain}`,
        method: 'DELETE',
        success: function () {
          if ($('#websites-list').children().length === 1 && currentPage > 1) {
            loadWebsites(currentPage - 1);
          } else {
            loadWebsites(currentPage);
          }
        },
      });
    }
  });

  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  function isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  $('#websites-list').on('click', '.view-components-btn', function () {
    const website = $(this).closest('li').data('website');
    const componentsList = $('#components-list');
    const websiteUserInfo = $('#website-user-info');
    componentsList.empty();
    websiteUserInfo.empty();

    if (website.meta && Object.keys(website.meta).length > 0) {
      const metaList = $('<ul class="list-group mb-3"></ul>');
      for (const [key, value] of Object.entries(website.meta)) {
        let valueHtml = value;
        if (isValidEmail(value)) {
          valueHtml = `<a href="mailto:${value}" class="text-decoration-none"><i class="bi bi-envelope me-2"></i>${value}</a>`;
        } else if (isValidUrl(value)) {
          const linkText = value.replace(/^https?:\/\//, '');
          valueHtml = `<a href="${value}" target="_blank" class="text-decoration-none">${linkText} <i class="bi bi-box-arrow-up-right"></i></a>`;
        }
        metaList.append(`<li class="list-group-item d-flex justify-content-between align-items-center"><strong>${key}</strong> <span>${valueHtml}</span></li>`);
      }
      websiteUserInfo.append(metaList);
    }

    const components = [...(website['wordpress-plugins'] || []), ...(website['wordpress-themes'] || [])];

    components.sort((a, b) => {
      if (a.has_vulnerabilities && !b.has_vulnerabilities) {
        return -1;
      }
      if (!a.has_vulnerabilities && b.has_vulnerabilities) {
        return 1;
      }
      return 0;
    });

    if (components.length === 0) {
      componentsList.append('<li class="list-group-item">No plugins or themes found.</li>');
    } else {
      components.forEach((component) => {
        const hasVulnerabilities = component.has_vulnerabilities;
        const vulnerabilityIcon = hasVulnerabilities ? `<i class="bi bi-exclamation-triangle-fill text-danger me-2"></i>` : `<i class="bi bi-plugin me-2"></i>`;

        let vulnerabilitiesHtml = '';
        if (hasVulnerabilities && component.vulnerabilities) {
          vulnerabilitiesHtml = '<div class="vulnerability-links">';
          component.vulnerabilities.forEach((url) => {
            let hostname = new URL(url).hostname;
            if (hostname.startsWith('www.')) {
              hostname = hostname.substring(4);
            }
            vulnerabilitiesHtml += `<a href="${url}" target="_blank" class="d-block"><i class="bi bi-info-circle me-2"></i>${hostname} <i class="bi bi-box-arrow-up-right"></i></a>`;
          });
          vulnerabilitiesHtml += '</div>';
        }

        const listItem = `
          <li class="list-group-item ${hasVulnerabilities ? 'list-group-item-danger' : ''}">
            <div class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-start">
                ${vulnerabilityIcon}
                <div>
                  <a href="/?q=${component.slug}" class="text-decoration-none">${component.slug}</a>
                  ${vulnerabilitiesHtml}
                </div>
              </div>
              <span class="badge bg-secondary rounded-pill">${component.version}</span>
            </div>
          </li>
        `;
        componentsList.append(listItem);
      });
    }

    const modalTitle = website.title || website.url;
    $('#components-modal-label').html(modalTitle);
    const componentsModal = new bootstrap.Modal($('#components-modal'));
    componentsModal.show();
  });
});
