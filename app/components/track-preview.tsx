import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '#app/components/ui/badge.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#app/components/ui/card.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { formatDuration } from '#app/utils/format-duration.ts'

// Constants for icon names
const ICONS = {
  CHECK_CIRCLED: 'check-circled',
  MAGNIFYING_GLASS: 'magnifying-glass',
  FILE_TEXT: 'file-text',
  CLOCK: 'clock',
  CALENDAR: 'calendar',
  QUESTION_MARK_CIRCLED: 'question-mark-circled',
  CROSS_1: 'cross-1',
  EYE_OPEN: 'eye-open',
  UPDATE: 'update',
  PLUS: 'plus',
} as const

// Helper function for date formatting
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString()
}

interface TrackPreviewData {
  id: string
  title: string
  artist: string
  duration: number
  thumbnailUrl: string
  serviceUrl: string
  publishedAt: string
  serviceName: string
}

interface TrackPreviewProps {
  track: TrackPreviewData
  isImporting?: boolean
  error?: string
  alreadyExists?: boolean
  existingTrackId?: string
}

export function TrackPreview({ track, isImporting = false, error, alreadyExists = false, existingTrackId }: TrackPreviewProps) {
  const [imageError, setImageError] = useState(false)

  const handleImageError = () => {
    setImageError(true)
  }

  // Computed values for conditional logic
  const statusIcon = alreadyExists ? ICONS.CHECK_CIRCLED : ICONS.MAGNIFYING_GLASS
  const statusIconColor = alreadyExists ? "text-green-600" : "text-muted-foreground"
  const title = alreadyExists ? "Track Already in Library" : "Preview Track"
  const description = alreadyExists 
    ? "This track is already in your library. You can view it or continue browsing."
    : "Review the track details before adding it to your library"

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Icon name={statusIcon} className={`h-5 w-5 ${statusIconColor}`} />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Track Info */}
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="flex-shrink-0">
            {!imageError && track.thumbnailUrl ? (
              <img
                src={track.thumbnailUrl}
                alt={`${track.title} thumbnail`}
                className="w-24 h-24 rounded-lg object-cover"
                onError={handleImageError}
              />
            ) : (
              <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center">
                <Icon name={ICONS.FILE_TEXT} className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>
          
          {/* Track Details */}
          <div className="flex-1 space-y-2">
            <div>
              <h3 className="text-lg font-semibold line-clamp-2">{track.title}</h3>
              <p className="text-muted-foreground">{track.artist}</p>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Icon name={ICONS.CLOCK} className="h-4 w-4" />
                <span>{formatDuration(track.duration)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Icon name={ICONS.CALENDAR} className="h-4 w-4" />
                <span>{formatDate(track.publishedAt)}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {track.serviceName}
              </Badge>
              <Link
                to={track.serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80 underline"
              >
                View on {track.serviceName}
              </Link>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="rounded-md bg-destructive/15 p-3">
            <div className="flex items-center gap-2">
              <Icon name={ICONS.QUESTION_MARK_CIRCLED} className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive font-medium">Import Failed</p>
            </div>
            <p className="text-sm text-destructive mt-1">{error}</p>
          </div>
        )}
      </CardContent>
      
      <CardFooter className="flex justify-between">
        {/* Cancel button - works without JavaScript */}
        <Button
          type="submit"
          form="cancel-form"
          variant="outline"
          disabled={isImporting}
        >
          <Icon name={ICONS.CROSS_1} className="mr-2 h-4 w-4" />
          Cancel
        </Button>

        {alreadyExists ? (
          <Button
            type="button"
            variant="default"
            asChild
          >
            <Link to={`/library/${existingTrackId}`}>
              <Icon name={ICONS.EYE_OPEN} className="mr-2 h-4 w-4" />
              View Track
            </Link>
          </Button>
        ) : (
          <Button
            type="submit"
            form="preview-form"
            disabled={isImporting}
          >
            {isImporting ? (
              <>
                <Icon name={ICONS.UPDATE} className="mr-2 h-4 w-4 animate-spin" />
                Adding to Library...
              </>
            ) : (
              <>
                <Icon name={ICONS.PLUS} className="mr-2 h-4 w-4" />
                Add to Library
              </>
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
