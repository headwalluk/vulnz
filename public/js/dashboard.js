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
    loadUserData();
  }

  function loadUserData() {
    loadApiKeys();

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
                            <button class="btn btn-sm btn-danger" data-key="${key.api_key}">Delete</button>
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

  const limit = 5;
  let currentPage = 1;

  function loadWebsites(page = 1) {
    currentPage = page;
    $.ajax({
      url: `/api/websites?page=${page}&limit=${limit}`,
      method: 'GET',
      success: function (data) {
        const websitesList = $('#websites-list');
        websitesList.empty();
        if (data.websites.length === 0) {
          websitesList.append('<div class="alert alert-info">You aren\'t monitoring any websites yet.</div>');
        } else {
          data.websites.forEach(function (website) {
          const hasVulnerabilities = website.vulnerability_count > 0;
          const vulnerabilityIcon = hasVulnerabilities
            ? `<i class="bi bi-exclamation-triangle-fill text-danger me-2 vulnerability-icon" title="Vulnerable components = ${website.vulnerability_count}"></i>`
            : `<i class="bi bi-check-circle-fill text-success me-2 vulnerability-icon" title="Vulnerable components = ${website.vulnerability_count}"></i>`;

          const websiteItem = $(`
                        <li class="list-group-item ${hasVulnerabilities ? 'list-group-item-danger' : ''}" data-domain="${website.domain}">
                            <div class="d-flex justify-content-between align-items-center">
                                <div class="d-flex align-items-center website-info">
                                    ${vulnerabilityIcon}
                                    <div>
                                        <strong>${website.title || website.domain}</strong>
                                        <br>
                                        <small><a href="${website.url}" target="_blank">${website.url} <i class="bi bi-box-arrow-up-right"></i></a></small>
                                    </div>
                                </div>
                                <div class="d-flex align-items-center">
                                    <button class="btn btn-sm btn-primary me-2 view-components-btn">Info...</button>
                                    <button class="btn btn-sm btn-danger delete-website-btn">Delete</button>
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

    console.log( `Total: ${total} ${typeof total}, Page: ${page}, Limit: ${limit}, Total Pages: ${totalPages}` );

    if (total === 0) {
      $('#website-toolbar').hide();
      $('#website-page-count').text('');
      return;
    }
    $('#website-toolbar').show();

    $('#website-page-count').text(`Page ${page} of ${totalPages}`);

    $('#first-page').toggleClass('disabled', page === 1);
    $('#prev-page').toggleClass('disabled', page === 1);
    $('#next-page').toggleClass('disabled', page === totalPages);
    $('#last-page').toggleClass('disabled', page === totalPages);

    $('#first-page').off('click').on('click', () => loadWebsites(1));
    $('#prev-page').off('click').on('click', () => loadWebsites(page - 1));
    $('#next-page').off('click').on('click', () => loadWebsites(page + 1));
    $('#last-page').off('click').on('click', () => loadWebsites(totalPages));
  }

  $('#websites-list').on('click', '.delete-website-btn', function () {
    const websiteDomain = $(this).closest('li').data('domain');
    if (confirm('Are you sure you want to delete this website?')) {
      $.ajax({
        url: `/api/websites/${websiteDomain}`,
        method: 'DELETE',
        success: function () {
          loadWebsites();
        },
      });
    }
  });

  loadWebsites();

  $('#websites-list').on('click', '.view-components-btn', function () {
    const website = $(this).closest('li').data('website');
    const componentsList = $('#components-list');
    componentsList.empty();

    const components = [...(website['wordpress-plugins'] || []), ...(website['wordpress-themes'] || [])];

    if (components.length === 0) {
      componentsList.append('<li class="list-group-item">No plugins or themes found.</li>');
    } else {
      components.forEach(component => {
        const hasVulnerabilities = component.has_vulnerabilities;
        const vulnerabilityIcon = hasVulnerabilities
          ? `<i class="bi bi-exclamation-triangle-fill text-danger"></i>`
          : '';
        
        let vulnerabilitiesHtml = '';
        if (hasVulnerabilities && component.vulnerabilities) {
          vulnerabilitiesHtml = '<div class="mt-2 vulnerability-links">';
          component.vulnerabilities.forEach(url => {
            let hostname = new URL(url).hostname;
            if (hostname.startsWith('www.')) {
              hostname = hostname.substring(4);
            }
            vulnerabilitiesHtml += `<a href="${url}" target="_blank" class="d-block">${hostname} <i class="bi bi-box-arrow-up-right"></i></a>`;
          });
          vulnerabilitiesHtml += '</div>';
        }

        const listItem = `
          <li class="list-group-item ${hasVulnerabilities ? 'list-group-item-danger' : ''}">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <strong>${component.slug}</strong> (v${component.version})
              </div>
              ${vulnerabilityIcon}
            </div>
            ${vulnerabilitiesHtml}
          </li>
        `;
        componentsList.append(listItem);
      });
    }

    const modalTitle = website.title || website.url;
    $('#components-modal-label').text(modalTitle);
    const componentsModal = new bootstrap.Modal($('#components-modal'));
    componentsModal.show();
  });
});
