$(document).ready(function() {
    // Check if the user is authenticated
    $.ajax({
        url: '/api/auth/me',
        method: 'GET',
        success: function(user) {
            // User is authenticated, proceed with loading dashboard
            loadDashboard(user);
        },
        error: function() {
            // User is not authenticated, redirect to login page
            window.location.href = '/login';
        }
    });

    function loadDashboard(user) {
        if (user.roles.includes('administrator')) {
            $('#admin-section').show();
            loadAdminData(user);
        }
        loadUserData(user);
    }

    function loadUserData(user) {
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
            // Initialize tooltips
            $('#api-keys-list [title]').tooltip();

            if (keys.length > 0) {
                const firstKey = keys[0].api_key;
                const curlCommand = `curl \\
  -H "X-API-Key: ${firstKey}" \\
  ${baseUrl}/api/components/wordpress-plugin/${slug}`;
                $('#curl-example').text(curlCommand);
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

    $('.code-container').on('click', '.copy-code-btn', function() {
        const textToCopy = $('#curl-example').text();
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

    function loadAdminData(user) {
        loadUsers(user, 1);
        loadComponents(currentPage);
        loadComponentTypes();
        loadRoles();

        $('#new-user-btn').on('click', function() {
            resetUserForm();
            $('#cancel-edit-user').show();
            $('#user-form-container').fadeIn();
            $('html, body').animate({
                scrollTop: $("#user-form-container").offset().top
            }, 500);
        });

        $('#first-page').on('click', function() {
            if (currentPage !== 1) {
                currentPage = 1;
                loadComponents(currentPage);
            }
        });

        $('#prev-page').on('click', function() {
            if (currentPage > 1) {
                currentPage--;
                loadComponents(currentPage);
            }
        });

        $('#next-page').on('click', function() {
            if (currentPage < totalPages) {
                currentPage++;
                loadComponents(currentPage);
            }
        });

        $('#last-page').on('click', function() {
            if (currentPage !== totalPages) {
                currentPage = totalPages;
                loadComponents(currentPage);
            }
        });

        $('#create-user-form').on('submit', function(e) {
            e.preventDefault();
            const username = $('#new-username').val();
            const password = $('#new-user-password').val();
            const roles = [];
            $('#new-user-roles input:checked').each(function() {
                roles.push($(this).val());
            });
            const blocked = $('#new-user-blocked').is(':checked');

            const url = editUserId ? `/api/users/${editUserId}` : '/api/users';
            const method = editUserId ? 'PUT' : 'POST';

            $.ajax({
                url,
                method,
                contentType: 'application/json',
                data: JSON.stringify({ username, password, roles, blocked }),
                success: function() {
                    resetUserForm();
                    loadUsers(user);
                },
                error: function(err) {
                    $('#error-message').text(err.responseText).show();
                }
            });
        });

        $('#create-component-form').on('submit', function(e) {
            e.preventDefault();
            const slug = $('#new-component-slug').val();
            const component_type_slug = $('#new-component-type-slug').val();
            const title = $('#new-component-title').val();
            const description = $('#new-component-description').val();

            const url = editComponentId ? `/api/components/${editComponentId}` : '/api/components';
            const method = editComponentId ? 'PUT' : 'POST';

            $.ajax({
                url,
                method,
                contentType: 'application/json',
                data: JSON.stringify({ slug, component_type_slug, title, description }),
                success: function() {
                    resetComponentForm();
                    loadComponents(currentPage);
                },
                error: function(err) {
                    $('#error-message').text(err.responseText).show();
                }
            });
        });

        $('#new-component-btn').on('click', function() {
            resetComponentForm();
            $('#cancel-edit-component').show();
            $('#component-form-container').fadeIn();
            $('html, body').animate({
                scrollTop: $("#component-form-container").offset().top
            }, 500);
        });
    }

    function loadUsers(currentUser, page) {
        $.ajax({
            url: `/api/users?page=${page}&limit=${limit}`,
            method: 'GET',
            success: function(data) {
                const { users, total } = data;
                const usersList = $('#users-list');
                usersList.empty();
                users.forEach(function(user) {
                    const deleteButton = currentUser.id === user.id ? '' : `<button class="btn btn-sm btn-danger" data-id="${user.id}">Delete</button>`;
                    const blockedIcon = user.blocked ? '<i class="bi bi-slash-circle-fill text-danger ms-2"></i>' : '';
                    usersList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <i class="bi bi-person-circle me-2"></i>
                                ${user.username}
                                ${blockedIcon}
                            </div>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-warning" data-id="${user.id}"><i class="bi bi-pencil"></i></button>
                                ${deleteButton.replace('Delete', '<i class="bi bi-trash"></i>')}
                            </div>
                        </li>
                    `);
                });
            }
        });
    }

    $('#users-list').on('click', '.btn-warning', function() {
        const userId = $(this).data('id');
        editUserId = userId;
        $.ajax({
            url: `/api/users/${userId}`,
            method: 'GET',
            success: function(user) {
                $('#new-username').val(user.username);
                $('#create-user-form h4').text('Edit User');
                $('#create-user-form button[type="submit"]').text('Save Changes');
                $('#cancel-edit-user').show();
                $('#new-user-password').prop('required', false);
                $('#new-user-blocked').prop('checked', user.blocked);
                $('#user-form-container').fadeIn();
                $('html, body').animate({
                    scrollTop: $("#user-form-container").offset().top
                }, 500);

                $('#new-user-roles input').each(function() {
                    $(this).prop('checked', user.roles.includes($(this).val()));
                });
            }
        });
    });

    $('#cancel-edit-user').on('click', function() {
        resetUserForm();
    });

    function resetUserForm() {
        editUserId = null;
        $('#create-user-form')[0].reset();
        $('#create-user-form h4').text('Create User');
        $('#create-user-form button[type="submit"]').text('Create User');
        $('#cancel-edit-user').hide();
        $('#new-user-password').prop('required', true);
        $('#user-form-container').hide();
        $('#new-user-roles input').each(function() {
            $(this).prop('checked', $(this).val() === 'user');
        });
    }

    $('#users-list').on('click', '.btn-danger', function() {
        const userId = $(this).data('id');
        if (confirm('Are you sure you want to delete this user?')) {
            $.ajax({
                url: `/api/users/${userId}`,
                method: 'DELETE',
                success: function() {
                    loadUsers(user);
                }
            });
        }
    });

    function loadRoles() {
        $.ajax({
            url: '/api/roles',
            method: 'GET',
            success: function(roles) {
                const container = $('#new-user-roles');
                container.empty();
                roles.forEach(function(role) {
                    const div = $('<div class="form-check"></div>');
                    const input = $(`<input class="form-check-input" type="checkbox" value="${role.name}" id="role-${role.name}">`);
                    const label = $(`<label class="form-check-label" for="role-${role.name}">${role.name}</label>`);
                    if (role.name === 'user') {
                        input.prop('checked', true);
                        input.prop('disabled', true);
                    }
                    div.append(input);
                    div.append(label);
                    container.append(div);
                });
            }
        });
    }

    function loadComponentTypes() {
        $.ajax({
            url: '/api/component-types',
            method: 'GET',
            success: function(types) {
                const select = $('#new-component-type-slug');
                select.empty();
                types.forEach(function(type) {
                    select.append(`<option value="${type.slug}">${type.title}</option>`);
                });
            }
        });
    }

    function loadComponents(page) {
        $.ajax({
            url: `/api/components?page=${page}&limit=${limit}`,
            method: 'GET',
            success: function(data) {
                const { components, total, page: currentPage, limit } = data;
                totalPages = Math.ceil(total / limit);
                const componentsList = $('#components-list');
                componentsList.empty();

                if (totalPages <= 1) {
                    $('#first-page, #prev-page, #page-indicator, #next-page, #last-page').hide();
                } else {
                    $('#first-page, #prev-page, #page-indicator, #next-page, #last-page').show();
                }

                if (components.length === 0) {
                    return;
                }

                components.forEach(function(component) {
                    let icon = '';
                    if (component.component_type_slug === 'wordpress-plugin') {
                        icon = '<i class="bi bi-puzzle-fill me-2"></i>';
                    } else if (component.component_type_slug === 'wordpress-theme') {
                        icon = '<i class="bi bi-palette-fill me-2"></i>';
                    }
                    componentsList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <span>
                                ${icon}
                                ${component.title}
                            </span>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-warning" data-id="${component.id}"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-sm btn-danger" data-id="${component.id}"><i class="bi bi-trash"></i></button>
                            </div>
                        </li>
                    `);
                });

                $('#page-indicator').text(`Page ${currentPage} of ${totalPages}`);
                $('#first-page').prop('disabled', currentPage === 1);
                $('#prev-page').prop('disabled', currentPage === 1);
                $('#next-page').prop('disabled', currentPage === totalPages);
                $('#last-page').prop('disabled', currentPage === totalPages);
            }
        });
    }

    $('#components-list').on('click', '.btn-danger', function() {
        const componentId = $(this).data('id');
        $.ajax({
            url: `/api/components/${componentId}`,
            method: 'DELETE',
            success: function() {
                loadComponents();
            }
        });
    });

    $('#components-list').on('click', '.btn-warning', function() {
        const componentId = $(this).data('id');
        editComponentId = componentId;
        $.ajax({
            url: `/api/components/${componentId}`,
            method: 'GET',
            success: function(component) {
                $('#new-component-slug').val(component.slug);
                $('#new-component-type-slug').val(component.component_type_slug);
                $('#new-component-title').val(component.title);
                $('#new-component-description').val(component.description);
                $('#create-component-form h4').text('Edit Component');
                $('#create-component-form button[type="submit"]').text('Save Changes');
                $('#cancel-edit-component').show();
                $('#component-form-container').fadeIn();
                $('html, body').animate({
                    scrollTop: $("#component-form-container").offset().top
                }, 500);
            }
        });
    });

    $('#cancel-edit-component').on('click', function() {
        resetComponentForm();
    });

    function resetComponentForm() {
        editComponentId = null;
        $('#create-component-form')[0].reset();
        $('#create-component-form h4').text('Create Component');
        $('#create-component-form button[type="submit"]').text('Create Component');
        $('#cancel-edit-component').hide();
        $('#component-form-container').hide();
    }

    $('#logout-button').on('click', function() {
        $.ajax({
            url: '/api/auth/logout',
            method: 'GET',
            success: function() {
                window.location.href = '/';
            }
        });
    });
});
