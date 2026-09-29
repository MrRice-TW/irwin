"""Generate certificates only for the loopback MongoDB integration tests."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

root = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
root.mkdir(exist_ok=True)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Workbench Local Test Only')])
start = datetime(2025, 1, 1, tzinfo=timezone.utc)
ca = x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(start).not_valid_after(start + timedelta(days=7300)).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(key, hashes.SHA256())
server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
cert = x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])).issuer_name(subject).public_key(server_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(start).not_valid_after(start+timedelta(days=7300)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]),critical=False).sign(key,hashes.SHA256())
(root / 'test-ca.pem').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
(root / 'test-server.pem').write_bytes(server_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.TraditionalOpenSSL,serialization.NoEncryption())+cert.public_bytes(serialization.Encoding.PEM))
