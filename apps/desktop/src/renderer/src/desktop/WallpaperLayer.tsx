import { wallpaperStyle, type WallpaperState } from './wallpaper'

export function WallpaperLayer({ wallpaper }: { wallpaper: WallpaperState }): React.JSX.Element {
  return (
    <div
      className="zw-wallpaper"
      style={{ position: 'fixed', inset: 0, ...wallpaperStyle(wallpaper) }}
    />
  )
}
