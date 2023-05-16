var selectedCell = null;

function selectCell(cellId) {
  selectedCell = document.getElementById(cellId);
  console.log(selectedCell);
  selectedCell.src = "./img/icon/selectedhint.png";
}

function changeImg(id) {
  if (selectedCell) {
    var originalImage = document.getElementById(id).children[0];
    selectedCell.src = originalImage.src;
    selectedCell.style.width = originalImage.width + 'px';
    selectedCell.style.height = originalImage.height + 'px';
    selectedCell = null;
  }
}


function resetImg(imgId) {
  var img = document.getElementById(imgId);
  
  selectedCell.style.width = 100 + 'px';
  selectedCell.style.height = 100 + 'px';
  img.src = "./img/icon/hint.png";
}

function resetAll() {
  var cells = document.querySelectorAll('.table img');
  for (var i = 0; i < cells.length; i++) {
    cells[i].src = './img/icon/hint.png';
    cells[i].style.width = '100px';
    cells[i].style.height = '100px';
  }
}