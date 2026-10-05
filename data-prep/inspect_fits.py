from astropy.io import fits

path = "raw/demo/epoch1/SPHEREx-D2.fits"
with fits.open(path) as hdul:
    hdul.info()
    for h in hdul:
        if h.data is not None and h.data.ndim == 2:
            print(h.name, h.data.shape, float(h.data.min()), float(h.data.max()))