$(document).ready(function () {
  // Make the Search button aware of Bootstrap's dark/light theme
  function updateSearchBtnTheme() {
    const btn = document.getElementById('search-button');
    if (!btn) return;
    const theme = document.documentElement.getAttribute('data-bs-theme') || 'light';
    btn.classList.remove('btn-light', 'btn-dark', 'btn-outline-light', 'btn-outline-dark');
    // Use outline variants to maintain contrast on the hero gradient background
    if (theme === 'dark') {
      btn.classList.add('btn-dark');
    } else {
      btn.classList.add('btn-light');
    }
  }

  // Initial sync after DOM is ready
  updateSearchBtnTheme();

  // React to future theme changes triggered by the header theme switcher
  new MutationObserver(() => updateSearchBtnTheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bs-theme'],
  });

  $('#search-input').focus();

  let currentPage = 1;
  let currentEcosystem = '';
  const limit = 10;

  // Load ecosystem filters
  $.ajax({
    url: '/api/ecosystems',
    method: 'GET',
    success: function (ecosystems) {
      if (ecosystems.length > 1) {
        const container = $('#ecosystem-filters');
        container.append('<button class="btn btn-sm btn-light ecosystem-btn active" data-ecosystem="">All</button>');
        ecosystems.forEach(function (eco) {
          container.append(`<button class="btn btn-sm btn-outline-light ecosystem-btn" data-ecosystem="${eco.slug}">${eco.name}</button>`);
        });
        container.css('display', '').removeClass('d-none');
      }
    },
  });

  $(document).on('click', '.ecosystem-btn', function () {
    $('.ecosystem-btn').removeClass('active btn-light').addClass('btn-outline-light');
    $(this).removeClass('btn-outline-light').addClass('active btn-light');
    currentEcosystem = $(this).data('ecosystem');
    const query = $('#search-input').val();
    if (query) {
      performSearch(query);
    }
  });

  function performSearch(query, page = 1) {
    currentPage = page;
    $('#spinner').show();
    $('#results-spinner').show();
    let url = `/api/components/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
    if (currentEcosystem) {
      url += `&ecosystem=${encodeURIComponent(currentEcosystem)}`;
    }
    $.ajax({
      url: url,
      method: 'GET',
      success: function (data) {
        const { components, total } = data;
        $('#spinner').hide();
        $('#results-spinner').hide();
        $('#main-content').css({
          height: 'auto',
          'padding-top': '5vh',
          'padding-bottom': '5vh',
        });
        const resultsList = $('#results-list');
        resultsList.empty();
        if (components.length > 0) {
          components.forEach(function (component, index) {
            let releasesHtml = '<ul class="list-group mt-2">';
            component.releases.forEach(function (release) {
              let vulnerabilitiesHtml = '';
              if (release.has_vulnerabilities) {
                vulnerabilitiesHtml = '<ul class="list-group mt-2">';
                release.vulnerabilities.forEach(function (vulnerability) {
                  let hostname = new URL(vulnerability).hostname;
                  if (hostname.startsWith('www.')) {
                    hostname = hostname.substring(4);
                  }
                  vulnerabilitiesHtml += `<li class="list-group-item list-group-item-danger"><a href="${vulnerability}" target="_blank" class="text-danger fw-bold">Reported on ${hostname} <i class="bi bi-box-arrow-up-right"></i></a></li>`;
                });
                vulnerabilitiesHtml += '</ul>';
              } else {
                vulnerabilitiesHtml = '<p class="text-success">No known vulnerabilities</p>';
              }
              releasesHtml += `<li class="list-group-item"><strong>Version:</strong> ${release.version} ${vulnerabilitiesHtml}</li>`;
            });
            releasesHtml += '</ul>';
            let titleHtml = `<h4>${component.title}</h4>`;
            if (component.url) {
              try {
                const componentUrl = new URL(component.url);
                titleHtml = `<h4><a href="${componentUrl.href}">${component.title}</a></h4>`;
              } catch {
                // Invalid URL, do nothing
                // console.error('Invalid URL for component:', component.url);
              }
            }
            const typeLabel = component.component_type_title || component.component_type_slug;
            const badgeClass = component.ecosystem_slug === 'npm' ? 'bg-danger' : 'bg-primary';
            const badgeHtml = `<span class="badge ${badgeClass} ms-2">${typeLabel}</span>`;
            titleHtml += `<p class="text-muted font-monospace">${component.slug} ${badgeHtml}</p>`;
            const listItem = $(`<li class="list-group-item text-dark pb-3">${titleHtml}${releasesHtml}</li>`);
            if (index > 0) {
              listItem.addClass('pt-3');
            }
            resultsList.append(listItem);
          });
        } else {
          resultsList.append('<li class="list-group-item">No components found.</li>');
        }

        const pagination = $('#pagination');
        pagination.empty();
        const pageIndicator = $('#page-indicator');
        const totalPages = Math.ceil(total / limit);
        if (totalPages > 1) {
          pageIndicator.text(`Page ${currentPage} of ${totalPages}`).show();
          let paginationHtml = '<ul class="pagination justify-content-center">';
          let startPage = Math.max(1, currentPage - 2);
          let endPage = Math.min(totalPages, currentPage + 2);

          if (currentPage > 3) {
            paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>';
            if (currentPage > 4) {
              paginationHtml += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
          }

          for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
          }

          if (currentPage < totalPages - 2) {
            if (currentPage < totalPages - 3) {
              paginationHtml += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
            paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
          }

          paginationHtml += '</ul>';
          pagination.html(paginationHtml);
        } else {
          pageIndicator.hide();
        }

        $('#search-results').fadeIn();
      },
      error: function () {
        $('#spinner').hide();
        $('#results-spinner').hide();
      },
    });
  }

  $('#search-button').on('click', function () {
    const query = $('#search-input').val();
    if (query) {
      performSearch(query);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = urlParams.get('q');
  if (queryParam) {
    $('#search-input').val(queryParam);
    $('#search-button').trigger('click');
  }

  $('#search-input').on('keyup', function (event) {
    if (event.key === 'Enter' || event.keyCode === 13) {
      $('#search-button').trigger('click');
    }
  });

  $('#pagination').on('click', '.page-link', function (event) {
    event.preventDefault();
    const page = $(this).data('page');
    const query = $('#search-input').val();
    if (query) {
      window.scrollTo(0, $('#search-results').offset().top - 80);
      performSearch(query, page);
    }
  });
});
