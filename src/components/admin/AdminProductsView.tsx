import React, { useState, useRef } from 'react';
import { Plus, Search, Edit3, Trash2, Copy, Eye, Check, X, Upload, Loader2 } from 'lucide-react';
import { AdminService } from '../../services/AdminService';
import { AdminProductFileUpload } from './AdminProductFileUpload';

const linknestCover = '/product-images/linknest-pro.jpg';

interface AdminProductsViewProps {
  products: any[];
  onRefresh: () => void;
  onSaveProduct: (product: any) => Promise<any>;
  onDeleteProduct: (id: string) => Promise<any>;
  onCloneProduct: (id: string) => Promise<any>;
}

export const AdminProductsView: React.FC<AdminProductsViewProps> = ({
  products,
  onRefresh,
  onSaveProduct,
  onDeleteProduct,
  onCloneProduct,
}) => {
  const [search, setSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = products.filter(p => p.title?.toLowerCase().includes(search.toLowerCase()) || p.category?.toLowerCase().includes(search.toLowerCase()));

  const handleOpenNew = () => {
    setEditingProduct({
      isNew: true,
      id: `prod_${Math.random().toString(36).substring(2, 8)}`,
      title: '',
      slug: '',
      category: 'templates',
      price: 499,
      compareAtPrice: 999,
      shortDescription: '',
      description: '',
      image: linknestCover,
      status: 'draft',
      stock: 999,
      previewUrl: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (p: any) => {
    setEditingProduct({ ...p, isNew: false });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const previewUrl = String(editingProduct.previewUrl || '').trim();
    if (previewUrl) {
      if (previewUrl.startsWith('/')) {
        const expectedPreviewPath = `/demos/${editingProduct.id}/`;
        if (previewUrl !== expectedPreviewPath) {
          alert(`Built-in preview path must match this product ID: ${expectedPreviewPath}`);
          return;
        }
      } else {
        try {
          const parsed = new URL(previewUrl);
          const hostname = parsed.hostname.toLowerCase();
          if (parsed.protocol !== 'https:' || hostname === 'vercel.app' || hostname.endsWith('.vercel.app')) {
            alert('Use an HTTPS custom demo domain. Direct *.vercel.app URLs are blocked.');
            return;
          }
        } catch {
          alert('Enter a built-in /demos/product-id/ path or a valid HTTPS custom demo URL.');
          return;
        }
      }
    }
    setSaving(true);
    setSuccessMsg('');
    try {
      const res = await onSaveProduct(editingProduct);
      if (res.success) {
        setSuccessMsg('Product saved successfully!');
        setTimeout(() => {
          setIsModalOpen(false);
          onRefresh();
        }, 800);
      } else {
        alert(res.message || 'Failed to save product.');
      }
    } catch {
      alert('Network error saving product.');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      alert('Image size must be 4MB or less.');
      return;
    }

    setUploading(true);
    try {
      const res = await AdminService.uploadImage(file);
      if (res.success && res.url) {
        setEditingProduct({ ...editingProduct, image: res.url });
      } else {
        alert(res.message || 'Failed to upload image.');
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Network error during upload.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {actionError && <p role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-700 dark:text-rose-300">{actionError}</p>}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={handleOpenNew}
          className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Add Product</span>
        </button>
      </div>

      {/* Products Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase">
                <th className="py-4 px-6">Product</th>
                <th className="py-4 px-6">Category</th>
                <th className="py-4 px-6">Price</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition">
                  <td className="py-4 px-6">
                    <div className="flex items-center space-x-3">
                      <img src={p.image} alt={p.title} className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-700" />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white line-clamp-1">{p.title}</p>
                        <p className="text-xs text-slate-400 font-mono">ID: {p.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-300 capitalize">{p.category}</td>
                  <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">₹{p.price}</td>
                  <td className="py-4 px-6">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                      p.status === 'published' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {p.status || 'published'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => handleOpenEdit(p)}
                        className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                        title="Edit Product"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          setActionError('');
                          try {
                            const result = await onCloneProduct(p.id);
                            if (!result.success) throw new Error(result.message || 'Could not duplicate product.');
                            onRefresh();
                          } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Could not duplicate product.'); }
                        }}
                        className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                        title="Duplicate Product"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm('Are you sure you want to archive this product?')) {
                            setActionError('');
                            try {
                              const result = await onDeleteProduct(p.id);
                              if (!result.success) throw new Error(result.message || 'Could not archive product.');
                              onRefresh();
                            } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Could not archive product.'); }
                          }
                        }}
                        className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                        title="Archive Product"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create Modal */}
      {isModalOpen && editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-800 shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingProduct.isNew ? 'Create New Product' : 'Edit Product'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 pt-4">
              {successMsg && <div className="p-3 bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-xl">{successMsg}</div>}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Product ID (Slug)</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.id}
                    disabled={!editingProduct.isNew}
                    onChange={(e) => setEditingProduct({ ...editingProduct, id: e.target.value, slug: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Category</label>
                  <select
                    value={editingProduct.category}
                    onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                  >
                    <option value="templates">Website Templates</option>
                    <option value="scripts">Scripts & Tools</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Product Title</label>
                <input
                  type="text"
                  required
                  value={editingProduct.title}
                  onChange={(e) => setEditingProduct({ ...editingProduct, title: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Price (INR)</label>
                  <input
                    type="number"
                    required
                    value={editingProduct.price}
                    onChange={(e) => setEditingProduct({ ...editingProduct, price: Number(e.target.value) })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Status</label>
                  <select
                    value={editingProduct.status || 'published'}
                    onChange={(e) => setEditingProduct({ ...editingProduct, status: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Short Description</label>
                <textarea
                  rows={2}
                  value={editingProduct.shortDescription || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, shortDescription: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Full Description (Rich Text / Markdown)</label>
                <textarea
                  rows={4}
                  value={editingProduct.description || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <label className="block text-sm">Version
                <input value={editingProduct.version || ''} onChange={e => setEditingProduct({ ...editingProduct, version: e.target.value })} className="block w-full border rounded-xl p-3" />
              </label>
              {(['requirements', 'whatsIncluded', 'features'] as const).map(field => <label key={field} className="block text-sm">{field === 'whatsIncluded' ? 'Included files (one per line)' : field === 'requirements' ? 'Requirements, dependencies and limitations (one per line)' : 'Features (one per line)'}
                <textarea rows={4} value={(editingProduct[field] || []).join('\n')} onChange={e => setEditingProduct({ ...editingProduct, [field]: e.target.value.split('\n') })} className="block w-full border rounded-xl p-3" />
              </label>)}
              <label className="block text-sm">Actual product license terms
                <textarea rows={4} value={editingProduct.licenseTerms || ''} onChange={e => setEditingProduct({ ...editingProduct, licenseTerms: e.target.value })} className="block w-full border rounded-xl p-3" />
              </label>
              <AdminProductFileUpload key={editingProduct.id} productId={editingProduct.id} isNew={Boolean(editingProduct.isNew)} />
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Live Demo URL or Built-in Path</label>
                <input
                  inputMode="url"
                  placeholder="/demos/product-id/ or https://demo.yourdomain.com"
                  value={editingProduct.previewUrl || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, previewUrl: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Use <code>/demos/{editingProduct.id}/</code> for this product's bundled preview, or add a custom HTTPS demo domain. Direct <code>*.vercel.app</code> URLs are blocked.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Product Image</label>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative group w-24 h-24 flex-shrink-0">
                    <img 
                      src={editingProduct.image || linknestCover} 
                      alt="Preview" 
                      className="w-full h-full object-cover rounded-xl border border-slate-200 dark:border-slate-700"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition rounded-xl flex items-center justify-center">
                      <button 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-white p-1.5 bg-white/20 rounded-lg backdrop-blur-sm"
                      >
                        <Upload className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="Or enter image URL..."
                      value={editingProduct.image || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, image: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <input 
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        className="hidden"
                        accept="image/*"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition"
                      >
                        {uploading ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Uploading...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-3 h-3" />
                            <span>Upload Image</span>
                          </>
                        )}
                      </button>
                      <p className="text-[10px] text-slate-400">Max 4MB. JPG, PNG, WEBP.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
