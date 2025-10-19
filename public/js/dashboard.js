$(document).ready(function() {
    let currentUser = null;

    // Check if the user is authenticated
    $.ajax({
        url: '/api/auth/me',
        method: 'GET',
        success: function(data) {
            if (!data.isAuthenticated) {
                return;
            }
            // User is authenticated, proceed with loading dashboard
            currentUser = data;
            loadDashboard();
        },
        error: function() {
            // User is not authenticated
        }
    });

    function loadDashboard() {
        $.ajax({
            url: '/api/config',
            method: 'GET',
            success: function(config) {
                if (currentUser.roles && currentUser.roles.includes('administrator') && config.setupMode === 'true') {
                    $('#setup-alert').show();
                }
                if (config.maxApiKeysPerUser) {
                    $('#max-api-keys').attr('max', config.maxApiKeysPerUser);
                }
            }
        });

        if (currentUser.roles.includes('administrator')) {
            $('#admin-section').show();
        }
        loadUserData();
    }

    function loadUserData() {
        loadApiKeys();

        $('#create-api-key-form').on('submit', function(e) {
            e.preventDefault();
            $.ajax({
                url: '/api/api-keys',
                method: 'POST',
                success: function() {
                    loadApiKeys();
                },
                error: function(err) {
                    alert(err.responseText);
                }
            });
        });

        $('#change-password-form').on('submit', function(e) {
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
                success: function() {
                    alert('Password changed successfully.');
                    $('#new-password').val('');
                    $('#re-enter-password').val('');
                },
                error: function(err) {
                    $('#error-message').text(err.responseText).show();
                }
            });
        });
    }

    function loadApiKeys() {
        $.when(
            $.ajax({
                url: '/api/api-keys',
                method: 'GET'
            }),
            $.ajax({
                url: '/api/config',
                method: 'GET'
            })
        ).done(function(apiKeysResponse, configResponse) {
            const keys = apiKeysResponse[0];
            const config = configResponse[0];
            const baseUrl = config.baseUrl;
            const slug = config.exampleWpComponentSlug;

            const keysList = $('#api-keys-list');
            keysList.empty();
            if (keys.length === 0) {
                keysList.append('<div class="alert alert-info">No API keys configured</div>');
            } else {
                keys.forEach(function(key) {
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

    $('#api-keys-list').on('click', '.copy-icon, .api-key-text', function() {
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

    $('#api-keys-list').on('click', '.btn-danger', function() {
        const key = $(this).data('key');
        $.ajax({
            url: `/api/api-keys/${key}`,
            method: 'DELETE',
            success: function() {
                loadApiKeys();
            }
        });
    });

    $('input[name="tool-switcher"]').on('change', function() {
        updateCodeExamples();
    });

    function updateCodeExamples() {
        const selectedTool = $('input[name="tool-switcher"]:checked').attr('id');
        const firstKey = $('#api-keys-list .api-key-text').first().data('key');
        if (!firstKey) return;

        $.ajax({
            url: '/api/config',
            method: 'GET',
            success: function(config) {
                const baseUrl = config.baseUrl;
                const slug = config.exampleWpComponentSlug;

                if (selectedTool === 'curl-btn') {
                    const curlCommand = `curl \\\n  -H "X-API-Key: ${firstKey}" \\\n  ${baseUrl}/api/components/wordpress-plugin/${slug} | jq .`;
                    $('#curl-example').text(curlCommand);

                    const curlSearchCommand = `curl \\\n  -H "X-API-Key: ${firstKey}" \\\n  '${baseUrl}/api/components/search?query=slider%20revolution' | jq .`;
                    $('#curl-search-example').text(curlSearchCommand);
                } else if (selectedTool === 'httpie-btn') {
                    const httpieCommand = `http ${baseUrl}/api/components/wordpress-plugin/${slug} X-API-Key:${firstKey} | jq .`;
                    $('#curl-example').text(httpieCommand);

                    const httpieSearchCommand = `http ${baseUrl}/api/components/search query=='slider revolution' X-API-Key:${firstKey} | jq .`;
                    $('#curl-search-example').text(httpieSearchCommand);
                }
            }
        });
    }

    $('.code-container').on('click', '.copy-code-btn', function() {
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

    let currentPage = 1;
    const limit = 10;
    let editUserId = null;
    let editComponentId = null;
    let totalPages = 1;
});
