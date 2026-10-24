"""Package existing owner templates for private Supabase Storage upload."""
from pathlib import Path
import json, zipfile, hashlib, os
root=Path(__file__).resolve().parents[1]
out=Path(os.environ.get('WORKSPACE_ROOT',str(root)))/'output'/'booyah-products'
out.mkdir(parents=True,exist_ok=True)
manifest=[]
for product in json.loads((root/'templates/collection.json').read_text()):
 dest=out/(product['id']+'.zip')
 with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as archive:
  for source in sorted((root/'templates'/product['id']).rglob('*')):
   if source.is_file(): archive.write(source,source.relative_to(root/'templates'/product['id']))
 with zipfile.ZipFile(dest) as archive:
  assert archive.testzip() is None
  assert 'LICENSE.txt' in archive.namelist()
 manifest.append({'productId':product['id'],'file':dest.name,'bucket':'products (private)','sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
(out/'upload-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Packaged and integrity-checked {len(manifest)} ZIP files.')
