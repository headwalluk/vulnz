$(document).ready(function () {
  let currentPage = 1;
  let sortOrder = 'desc';

  let totalPages = 1;

  function fetchLogs() {
    $.ajax({
      url: `/api/logs?page=${currentPage}&sort=${sortOrder}`,
      method: 'GET',
      success: function (data) {
        const { logs, total, page, limit } = data;
        totalPages = Math.ceil(total / limit);
        const tableBody = $('#logs-table-body');
        tableBody.empty();
        logs.forEach((log) => {
          tableBody.append(`
                                <tr>
                                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                                    <td>${log.username}</td>
                                    <td>${log.method}</td>
                                    <td class="truncate-text" title="${log.route}">${log.route}</td>
                                    <td>${log.ip_address}</td>
                                    <td>${log.status_code}</td>
                                </tr>
                            `);
        });

        const pagination = $('#pagination');
        pagination.empty();
        if (totalPages > 1) {
          let paginationHtml = '<ul class="pagination justify-content-center">';
          let startPage = Math.max(1, page - 2);
          let endPage = Math.min(totalPages, page + 2);

          if (page > 3) {
            paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>';
            if (page > 4) {
              paginationHtml += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
          }

          for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `<li class="page-item ${i === page ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
          }

          if (page < totalPages - 2) {
            if (page < totalPages - 3) {
              paginationHtml += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
            paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
          }

          paginationHtml += '</ul>';
          pagination.html(paginationHtml);
        }
      },
    });
  }

  $('#sort-order').on('change', function () {
    sortOrder = $(this).val();
    fetchLogs();
  });

  $('#pagination').on('click', '.page-link', function (e) {
    e.preventDefault();
    currentPage = $(this).data('page');
    fetchLogs();
  });

  $('#first-page').on('click', function () {
    currentPage = 1;
    fetchLogs();
  });

  $('#prev-page').on('click', function () {
    currentPage = Math.max(1, currentPage - 1);
    fetchLogs();
  });

  $('#next-page').on('click', function () {
    currentPage++;
    fetchLogs();
  });

  $('#last-page').on('click', function () {
    currentPage = totalPages;
    fetchLogs();
  });

  fetchLogs();
});
