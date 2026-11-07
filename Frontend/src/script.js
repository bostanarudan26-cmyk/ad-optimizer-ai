const analyzeBtn = document.getElementById('analyzeBtn');
const zonaUpload = document.getElementById('zona-upload');
const zonaLoading = document.getElementById('zona-loading');
const zonaRezultate = document.getElementById('zona-rezultate');

analyzeBtn.addEventListener('click', () => {
    zonaUpload.classList.add('hidden');
    zonaLoading.classList.remove('hidden');
    zonaLoading.classList.add('flex'); 

    setTimeout(() => {
        zonaLoading.classList.add('hidden');
        zonaLoading.classList.remove('flex');
        zonaRezultate.classList.remove('hidden');
    }, 3000); 
});