function renderAbcFile(file)
{
    var f = new XMLHttpRequest();
    f.open("GET", file, false);
    f.onreadystatechange = function ()
    {
        if(f.readyState === 4)
        {
            if(f.status === 200 || f.status == 0)
            {
                var res= f.responseText;
                ABCJS.renderAbc('notation', res);
            }
        }
    }
    f.send(null);
}

function loadSongs() {
  alert("Image is loaded");
}
