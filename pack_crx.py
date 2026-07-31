"""
CRX3 packer — Generates signed .crx from extension directory.
Usage: python pack_crx.py
"""
import struct, zipfile, hashlib, os
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend

def encode_varint(n):
    buf = []
    while n > 127:
        buf.append((n & 0x7F) | 0x80); n >>= 7
    buf.append(n & 0x7F)
    return bytes(buf)

def encode_ld(field, data):
    tag = (field << 3) | 2
    return encode_varint(tag) + encode_varint(len(data)) + data

def build_header(pk_der, sig):
    return encode_ld(2, encode_ld(1, pk_der) + encode_ld(2, sig))

SKIP = {'pack_crx.py', '.gitignore', 'extension.pem'}
SKIP_EXT = {'.crx', '.tmp.zip', '.pyc'}

def pack():
    ext_dir = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(ext_dir, 'hd-web-screenshot.crx')
    key_path = os.path.join(ext_dir, 'extension.pem')

    tmp = out + '.tmp.zip'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
        n = 0
        for root, dirs, files in os.walk(ext_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for fn in files:
                if fn in SKIP or fn.startswith('.') or any(fn.endswith(e) for e in SKIP_EXT):
                    continue
                full = os.path.join(root, fn)
                zf.write(full, os.path.relpath(full, ext_dir))
                n += 1
        print(f'  {n} files zipped')

    with open(tmp, 'rb') as f:
        zip_data = f.read()

    if os.path.exists(key_path):
        with open(key_path, 'rb') as f:
            pk = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
        print('  Using existing key')
    else:
        pk = rsa.generate_private_key(65537, 2048, backend=default_backend())
        with open(key_path, 'wb') as f:
            f.write(pk.private_bytes(encoding=serialization.Encoding.PEM,
                     format=serialization.PrivateFormat.PKCS8,
                     encryption_algorithm=serialization.NoEncryption()))
        print('  Generated new RSA 2048 key')

    pub_der = pk.public_key().public_bytes(encoding=serialization.Encoding.DER,
                format=serialization.PublicFormat.SubjectPublicKeyInfo)
    sig = pk.sign(hashlib.sha256(zip_data).digest(), padding.PKCS1v15(), hashes.SHA256())
    hdr = build_header(pub_der, sig)

    with open(out, 'wb') as f:
        f.write(b'Cr24' + struct.pack('<II', 3, len(hdr)) + hdr + zip_data)

    os.remove(tmp)
    print(f'  Done: {out} ({os.path.getsize(out)/1024:.0f} KB)')

if __name__ == '__main__':
    pack()
