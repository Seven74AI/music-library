import { Form, Link } from 'react-router'
import { Badge } from '#app/components/ui/badge.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#app/components/ui/card.tsx'
import { Icon, type IconName } from '#app/components/ui/icon.tsx'


interface PreviewAction {
  type: 'submit' | 'link' | 'button'
  label: string
  icon?: IconName
  href?: string
  formAction?: string
  formData?: Record<string, string>
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
}

interface PreviewCardProps {
  title: string
  description: string
  icon?: IconName
  iconColor?: string
  thumbnail?: {
    src: string
    alt: string
  }
  content: {
    title: string
    subtitle?: string
    badges?: Array<{
      label: string
      variant?: 'default' | 'secondary' | 'destructive' | 'outline'
    }>
  }
  error?: string
  isSubmitting?: boolean
  primaryAction: PreviewAction
  secondaryAction?: PreviewAction
}

export function PreviewCard({
  title,
  description,
  icon,
  iconColor = 'text-muted-foreground',
  thumbnail,
  content,
  error,
  isSubmitting = false,
  primaryAction,
  secondaryAction
}: PreviewCardProps) {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-3">
          {icon && (
            <Icon 
              name={icon} 
              className={`h-5 w-5 ${iconColor}`} 
            />
          )}
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Content Display */}
        <div className="flex gap-4">
          {thumbnail && (
            <img
              src={thumbnail.src}
              alt={thumbnail.alt}
              className="w-24 h-24 rounded-lg object-cover"
            />
          )}
          <div className="flex-1 space-y-2">
            <h3 className="font-semibold text-lg">{content.title}</h3>
            {content.subtitle && (
              <p className="text-muted-foreground">{content.subtitle}</p>
            )}
            {content.badges && (
              <div className="flex items-center gap-2">
                {content.badges.map((badge) => (
                  <Badge key={badge.label} variant={badge.variant || 'secondary'}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-between">
        {/* Secondary Action (usually Cancel) */}
        {secondaryAction && (
          <ActionButton 
            action={secondaryAction} 
            isSubmitting={isSubmitting}
          />
        )}

        {/* Primary Action */}
        <ActionButton 
          action={primaryAction} 
          isSubmitting={isSubmitting}
        />
      </CardFooter>
    </Card>
  )
}

function ActionButton({ 
  action, 
  isSubmitting 
}: { 
  action: PreviewAction
  isSubmitting: boolean 
}) {
  const iconElement = action.icon ? (
    <Icon name={action.icon} className="mr-2 h-4 w-4" />
  ) : null

  const buttonContent = (
    <>
      {iconElement}
      {action.label}
    </>
  )

  if (action.type === 'link' && action.href) {
    return (
      <Button asChild variant={action.variant}>
        <Link to={action.href}>
          {buttonContent}
        </Link>
      </Button>
    )
  }

  if (action.type === 'submit' && action.formAction) {
    return (
      <Form method="post" action={action.formAction}>
        {action.formData && Object.entries(action.formData).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <Button 
          type="submit" 
          variant={action.variant} 
          disabled={isSubmitting}
        >
          {buttonContent}
        </Button>
      </Form>
    )
  }

  // Fallback for button type
  return (
    <Button 
      type="button" 
      variant={action.variant}
      disabled={isSubmitting}
    >
      {buttonContent}
    </Button>
  )
}
